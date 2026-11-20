import base64
import json
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from typing import Literal

from Crypto.Cipher import AES
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from web3 import Web3
from web3.exceptions import TransactionNotFound

from app.api.auth import allowed_origin, api_error, get_session_wallet
from app.api.documents import active_batch_owner, parse_document_token_id
from app.core.config import settings
from app.core.database import get_database_path
from app.services.web3_service import create_web3_client, get_participant

router = APIRouter(prefix="/api/v1/encryption/prices", tags=["Prices"])
PREFIX = b"DSCP1"


class PriceRequest(BaseModel):
    tokenId: str
    amount: str = Field(pattern=r"^(0|[1-9][0-9]{0,15})([.][0-9]{1,2})?$")
    currency: Literal["USD"]
    recipient: str = Field(pattern=r"^0x[0-9a-fA-F]{40}$")


class PriceReference(BaseModel):
    tokenId: str
    txHash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")


def wrapping_cipher():
    try:
        key = base64.b64decode(settings.price_key_v1.get_secret_value(), validate=True)
        if len(key) == 32:
            return AES.new(key, AES.MODE_KW)
    except ValueError:
        pass
    raise RuntimeError("Price key unavailable")


def price_cipher(dek, nonce, token, sender, recipient, transfer_id):
    cipher = AES.new(dek, AES.MODE_GCM, nonce=nonce)
    context = [1, settings.sepolia_chain_id, settings.contract_address.lower(),
               str(token), sender.lower(), recipient.lower(), "USD", transfer_id.hex()]
    cipher.update(json.dumps(context, separators=(",", ":")).encode())
    return cipher


@router.post("")
def encrypt_price(body: PriceRequest, request: Request):
    access = active_batch_owner(body.tokenId, request)
    if isinstance(access, JSONResponse):
        return access
    wallet, token, batch = access
    try:
        recipient = get_participant(body.recipient)
    except Exception:
        return api_error(503, "CHAIN_UNAVAILABLE", "Cannot verify transfer route")
    routes = {"AT_MANUFACTURER": {"DISTRIBUTOR"}, "AT_DISTRIBUTOR": {"PHARMACY", "HOSPITAL"}}
    if (not batch or batch["expiry_date"] <= time.time() or not recipient["active"]
            or wallet.lower() == body.recipient.lower()
            or recipient["role"] not in routes.get(batch["stage"], set())):
        return api_error(403, "INVALID_ROUTE", "Recipient or batch is ineligible")

    transfer_id, nonce, dek = secrets.token_bytes(16), secrets.token_bytes(12), secrets.token_bytes(32)
    try:
        wrapped = wrapping_cipher().seal(dek)
        cipher = price_cipher(dek, nonce, token, wallet, body.recipient, transfer_id)
        ciphertext, tag = cipher.encrypt_and_digest(body.amount.encode())
        with closing(sqlite3.connect(get_database_path())) as db, db:
            db.executemany(
                "INSERT INTO price_key_access(chain_id,token_id,transfer_tx_hash,wallet_address,"
                "wrapped_dek,key_version,transfer_id) VALUES(?,?,'',?,?,1,?)",
                [(settings.sepolia_chain_id, str(token), party.lower(), wrapped, transfer_id.hex())
                 for party in (wallet, body.recipient)]
            )
    except (RuntimeError, sqlite3.Error):
        return api_error(503, "KEY_STORE_UNAVAILABLE", "Price key store unavailable")
    envelope = PREFIX + transfer_id + nonce + tag + ciphertext
    return JSONResponse({"data": {"encryptedPrice": "0x" + envelope.hex()}},
                        headers={"Cache-Control": "no-store"})


def confirmed_transfer(tx_hash, token):
    contract = create_web3_client()
    eth = contract.w3.eth
    receipt = eth.get_transaction_receipt(tx_hash)
    if (receipt.status != 1 or eth.block_number - receipt.blockNumber + 1 < max(1, settings.chain_confirmations)
            or eth.get_block(receipt.blockNumber).hash != receipt.blockHash):
        return None
    events = []
    for log in receipt.logs:
        if log.address.lower() != contract.address.lower() or not log.topics:
            continue
        if log.topics[0] == Web3.keccak(text="CustodyTransferred(uint256,address,address,bytes)"):
            args = contract.events.CustodyTransferred().process_log(log)["args"]
            if args["tokenId"] == token:
                events.append(args)
    return events[0] if len(events) == 1 else None


def audit(db, wallet, tx_hash, outcome):
    db.execute("INSERT INTO audit_logs(actor_wallet,action,resource,outcome,timestamp,request_id) "
               "VALUES(?,'DECRYPT_PRICE',?,?,?,?)",
               (wallet, tx_hash, outcome, datetime.now(timezone.utc).isoformat(), secrets.token_hex(8)))


@router.post("/decrypt")
def decrypt_price(body: PriceReference, request: Request):
    wallet = get_session_wallet(request)
    if not wallet:
        return api_error(401, "AUTH_REQUIRED", "Wallet authentication required")
    if not allowed_origin(request):
        return api_error(403, "INVALID_ORIGIN", "Origin is not allowed")
    try:
        token = parse_document_token_id(body.tokenId)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")
    try:
        participant = get_participant(wallet)
        event = confirmed_transfer(body.txHash, token)
    except TransactionNotFound:
        event = None
    except Exception:
        return api_error(503, "CHAIN_UNAVAILABLE", "Cannot verify transfer")
    if not event:
        return api_error(409, "TRANSFER_UNCONFIRMED", "Confirmed transfer required")
    envelope = bytes(event["encryptedPrice"])
    try:
        with closing(sqlite3.connect(get_database_path())) as db, db:
            if (not participant["active"] or participant["role"] == "NONE" or wallet.lower()
                    not in (event["from"].lower(), event["to"].lower())):
                audit(db, wallet, body.txHash, "DENIED")
                return api_error(403, "PRICE_FORBIDDEN", "Transfer party required")
            if not envelope.startswith(PREFIX) or len(envelope) <= 49:
                return api_error(422, "UNSUPPORTED_PRICE_FORMAT", "Unsupported price envelope")
            transfer_id, nonce, tag = envelope[5:21], envelope[21:33], envelope[33:49]
            row = db.execute("SELECT wrapped_dek FROM price_key_access WHERE chain_id=? "
                             "AND token_id=? AND wallet_address=? AND transfer_id=? AND key_version=1",
                             (settings.sepolia_chain_id, str(token), wallet.lower(), transfer_id.hex())).fetchone()
            if row is None:
                return api_error(404, "KEY_NOT_FOUND", "Transfer key unavailable")
            dek = wrapping_cipher().unseal(row[0])
            cipher = price_cipher(dek, nonce, token, event["from"], event["to"], transfer_id)
            amount = cipher.decrypt_and_verify(envelope[49:], tag).decode()
            db.execute("UPDATE price_key_access SET transfer_tx_hash=? WHERE transfer_id=?",
                       (body.txHash.lower(), transfer_id.hex()))
            audit(db, wallet, body.txHash, "ALLOWED")
    except ValueError:
        return api_error(422, "INVALID_CIPHERTEXT", "Price integrity check failed")
    except (RuntimeError, sqlite3.Error):
        return api_error(503, "KEY_STORE_UNAVAILABLE", "Price key store unavailable")
    return JSONResponse({"data": {"amount": amount, "currency": "USD"}},
                        headers={"Cache-Control": "no-store"})
