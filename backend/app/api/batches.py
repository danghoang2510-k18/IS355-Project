import json
import sqlite3
import time
from contextlib import closing

from fastapi import APIRouter, Query
from web3 import Web3

from app.api.auth import api_error
from app.api.documents import parse_document_token_id
from app.core.config import settings
from app.core.database import get_database_path
from app.services.indexer import checkpoint
from app.services.web3_service import get_medicine, verify_product

router = APIRouter(prefix="/api/v1/batches", tags=["Batches"])


def indexed_page(token, page, limit, owner=None):
    chain, address = settings.sepolia_chain_id, settings.contract_address.lower()
    try:
        with closing(sqlite3.connect(get_database_path())) as db:
            db.execute("BEGIN")
            cursor = checkpoint(db, chain, address)
            if not cursor or cursor[0] < cursor[2] or time.time() - cursor[3] > 180:
                return api_error(503, "INDEX_NOT_READY", "Confirmed event index is syncing or stale")
            where = "chain_id=? AND contract_address=? AND confirmation_status='CONFIRMED'"
            params = [chain, address]
            if token is None:
                where += " AND event_name='MedicineRegistered'"
            else:
                where += " AND token_id=?"
                params.append(str(token))
            if owner is not None:
                where += """
                    AND lower((
                        SELECT CASE state.event_name
                            WHEN 'MedicineRegistered' THEN json_extract(state.payload_json, '$.manufacturer')
                            WHEN 'CustodyTransferred' THEN coalesce(state.to_wallet, json_extract(state.payload_json, '$.to'))
                        END
                        FROM chain_events AS state
                        WHERE state.chain_id=chain_events.chain_id AND state.contract_address=chain_events.contract_address
                          AND state.token_id=chain_events.token_id AND state.confirmation_status='CONFIRMED'
                          AND state.event_name IN ('MedicineRegistered','CustodyTransferred','TokenBurned')
                        ORDER BY state.block_number DESC,state.log_index DESC LIMIT 1
                    )) = ?
                """
                params.append(Web3.to_checksum_address(owner).lower())
            rows = db.execute("SELECT token_id,event_name,payload_json,occurred_at,tx_hash FROM chain_events WHERE "
                              + where + " ORDER BY block_number,log_index LIMIT ? OFFSET ?",
                              (*params, limit + 1, (page - 1) * limit)).fetchall()
            data = [{"tokenId": token_id, "event": name, "args": json.loads(payload),
                     "timestamp": int(occurred), "txHash": tx} for token_id, name, payload, occurred, tx in rows[:limit]]
            return {"data": data, "meta": {"indexedThrough": cursor[0], "blockHash": cursor[1], "chainId": chain,
                                            "contract": address, "hasMore": len(rows) > limit}}
    except sqlite3.Error:
        return api_error(503, "INDEX_NOT_READY", "Index storage unavailable")


@router.get("")
def registry(page: int = Query(1, ge=1, le=1000000), limit: int = Query(100, ge=1, le=200),
             owner: str | None = None):
    if owner is not None and not Web3.is_address(owner):
        return api_error(400, "VALIDATION_ERROR", "Invalid owner address")
    return indexed_page(None, page, limit, owner)


@router.get("/{token_id}/timeline")
def timeline(token_id: str, page: int = Query(1, ge=1, le=1000000), limit: int = Query(100, ge=1, le=200)):
    try:
        token = parse_document_token_id(token_id)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")
    return indexed_page(token, page, limit)


@router.get("/{token_id}")
def batch_detail(token_id: str):
    try:
        token = parse_document_token_id(token_id)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")
    try:
        batch = get_medicine(token)
        if batch is None:
            return api_error(404, "BATCH_NOT_FOUND", "Batch not found")
        return {"data": {**batch, **verify_product(token)}}
    except Exception:
        return api_error(503, "CHAIN_UNAVAILABLE", "Cannot read batch")
