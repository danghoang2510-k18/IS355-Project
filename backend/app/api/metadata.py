
import hashlib
import json
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import date, datetime, timezone
from uuid import UUID

import requests
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from anyio import from_thread

from app.api.auth import allowed_origin, api_error, get_session_wallet
from app.core.database import get_database_path
from app.services.pinata_service import UploadNotStarted, recover_nft_metadata, upload_nft_metadata
from app.services.web3_service import get_participant


router = APIRouter(prefix="/api/v1/metadata", tags=["Metadata"])

FIELDS = {
    "gtin",
    "batchNumber",
    "medicineName",
    "manufactureDate",
    "expiryDate"
}


def validate_batch(body):
    if not isinstance(body, dict) or set(body) != FIELDS:
        raise ValueError("Invalid request fields")

    if any(not isinstance(value, str) for value in body.values()):
        raise ValueError("All fields must be strings")

    payload = {
        name: value.strip()
        for name, value in body.items()
    }

    if not re.fullmatch(r"[0-9]{14}", payload["gtin"]):
        raise ValueError("GTIN must contain 14 digits")

    if not 1 <= len(payload["batchNumber"]) <= 64:
        raise ValueError("Invalid batch number")

    if not 1 <= len(payload["medicineName"]) <= 120:
        raise ValueError("Invalid medicine name")

    try:
        for name in ("manufactureDate", "expiryDate"):
            if not re.fullmatch(
                r"[0-9]{4}-[0-9]{2}-[0-9]{2}",
                payload[name]
            ):
                raise ValueError("Invalid date format")

        manufactured = date.fromisoformat(
            payload["manufactureDate"]
        )
        expires = date.fromisoformat(
            payload["expiryDate"]
        )
    except ValueError as error:
        raise ValueError("Invalid dates") from error

    today = datetime.now(timezone.utc).date()

    if manufactured > today or expires <= today or expires <= manufactured:
        raise ValueError("Invalid manufacture or expiry date")

    return payload


def build_metadata(payload, manufacturer):
    return {
        "schemaVersion": "1.0",
        "name": (
            f"{payload['medicineName']} - "
            f"{payload['batchNumber']}"
        ),
        "description": "Medicine batch metadata for supply-chain traceability.",
        "attributes": [
            {"trait_type": "GTIN", "value": payload["gtin"]},
            {"trait_type": "Batch Number", "value": payload["batchNumber"]},
            {"trait_type": "Manufacture Date", "value": payload["manufactureDate"]},
            {"trait_type": "Expiry Date", "value": payload["expiryDate"]},
            {"trait_type": "Manufacturer", "value": manufacturer}
        ]
    }


def make_response(result, status_code):
    return JSONResponse(
        status_code=status_code,
        content={
            "data": result,
            "meta": {
                "requestId": f"req_{secrets.token_hex(8)}"
            }
        }
    )


@router.post("/medicine-batches")
def create_medicine_metadata(
    request: Request,
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key"
    )
):
    wallet = get_session_wallet(request)

    if not wallet:
        return api_error(401, "AUTH_REQUIRED", "Wallet authentication required")

    if not allowed_origin(request):
        return api_error(403, "INVALID_ORIGIN", "Origin is not allowed")

    try:
        raw_body = from_thread.run(request.body)
        payload = validate_batch(json.loads(raw_body))
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid medicine batch data")

    try:
        key = idempotency_key.strip() if idempotency_key else ""
        parsed_key = UUID(key)

        if parsed_key.version != 4 or str(parsed_key) != key.lower():
            raise ValueError("Invalid idempotency key")
    except (ValueError, AttributeError):
        return api_error(400, "VALIDATION_ERROR", "Invalid Idempotency-Key")

    try:
        participant = get_participant(wallet)
    except Exception:
        return api_error(
            500,
            "INTERNAL_SERVER_ERROR",
            "Unable to verify on-chain role"
        )

    if (
        participant["role"] != "MANUFACTURER"
        or participant["active"] is not True
    ):
        return api_error(
            403,
            "MANUFACTURER_ROLE_REQUIRED",
            "Active Manufacturer role required"
        )

    content = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":")
    ).encode("utf-8")

    payload_hash = hashlib.sha256(content).hexdigest()
    db_path = get_database_path()

    filename = "metadata-" + hashlib.sha256(f"{wallet.lower()}:{key}".encode()).hexdigest() + ".json"
    metadata = build_metadata(payload, participant["organization_name"])
    try:
        with closing(sqlite3.connect(db_path, timeout=10)) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            saved = connection.execute(
                "SELECT payload_hash,response_json,metadata_json FROM metadata_requests "
                "WHERE wallet_address=? AND idempotency_key=?", (wallet, key)
            ).fetchone()
            if saved:
                if saved[0] != payload_hash:
                    return api_error(409, "IDEMPOTENCY_KEY_REUSED", "Key was used with another payload")
                if saved[1]:
                    return make_response(json.loads(saved[1]), 200)
            else:
                connection.execute(
                    "INSERT INTO metadata_requests(wallet_address,idempotency_key,payload_hash,"
                    "metadata_json,created_at) VALUES(?,?,?,?,?)",
                    (wallet, key, payload_hash, json.dumps(metadata), datetime.now(timezone.utc).isoformat())
                )

        try:
            if saved:
                original = json.loads(saved[2]) if saved[2] else metadata
                result = recover_nft_metadata(original, filename, legacy=saved[2] is None)
                if result is None:
                    return api_error(503, "STORAGE_UNAVAILABLE", "Pending upload has no verified pin yet")
            else:
                result = upload_nft_metadata(metadata, filename)
        except (UploadNotStarted, requests.ConnectTimeout):
            if not saved:
                with closing(sqlite3.connect(db_path)) as connection, connection:
                    connection.execute("DELETE FROM metadata_requests WHERE wallet_address=? AND "
                                       "idempotency_key=? AND response_json IS NULL", (wallet, key))
            return api_error(502, "PINATA_UPLOAD_FAILED", "Upload could not start")
        except (requests.RequestException, RuntimeError, ValueError, KeyError, TypeError):
            return api_error(502, "PINATA_UPLOAD_FAILED", "Pinata result could not be verified")

        with closing(sqlite3.connect(db_path)) as connection, connection:
            connection.execute("UPDATE metadata_requests SET response_json=COALESCE(response_json,?) "
                               "WHERE wallet_address=? AND idempotency_key=?",
                               (json.dumps(result), wallet, key))
    except sqlite3.Error:
        return api_error(503, "STORAGE_UNAVAILABLE", "Cannot read or persist the upload receipt")
    return make_response(result, 200 if saved else 201)
