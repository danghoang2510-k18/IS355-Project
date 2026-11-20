
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
import hashlib
from fastapi import Response
from app.core.config import settings
from app.services.indexer import linked_document_cids
from app.services.document_crypto import OVERHEAD, decrypt_document, encrypt_document
from app.services.pinata_service import download_public_document
from app.services.web3_service import get_document as get_chain_document
import requests
from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.api.auth import allowed_origin, api_error, get_session_wallet
from app.core.database import get_database_path
from app.services.document_service import (
    MAX_DOCUMENT_SIZE,
    validate_document
)
from app.services.pinata_service import UploadNotStarted, list_pins, upload_public_document
from app.services.web3_service import (
    DOCUMENT_TYPE_IDS,
    get_medicine,
    get_participant,
    get_token_owner
)


router = APIRouter(prefix="/api/v1/batches", tags=["Documents"])

STAGE_ROLES = {
    "AT_MANUFACTURER": {"MANUFACTURER"},
    "AT_DISTRIBUTOR": {"DISTRIBUTOR"},
    "AT_DISPENSER": {"PHARMACY", "HOSPITAL"}
}

FILE_EXTENSIONS = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/json": "json"
}


def active_batch_owner(token_id: str, request: Request, *, require_origin: bool = False):
    wallet = get_session_wallet(request)

    if not wallet:
        return api_error(
            401, "AUTH_REQUIRED", "Wallet authentication required"
        )

    same_origin_browser = (request.headers.get("sec-fetch-site") == "same-origin"
                           and str(request.base_url).rstrip("/") == settings.frontend_origin.rstrip("/"))
    if not allowed_origin(request) or (require_origin and not request.headers.get("origin") and not same_origin_browser):
        return api_error(
            403, "INVALID_ORIGIN", "Origin is not allowed"
        )

    try:
        token_number = parse_document_token_id(token_id)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")

    try:
        owner = get_token_owner(token_number)
        batch = get_medicine(token_number)
        participant = get_participant(wallet)
    except Exception:
        return api_error(
            503, "CHAIN_UNAVAILABLE", "Unable to verify blockchain state"
        )

    if owner is None or batch is None:
        return api_error(
            404, "BATCH_NOT_FOUND", "Active batch not found"
        )

    allowed_roles = STAGE_ROLES.get(batch["stage"], set())

    if (
        owner.lower() != wallet.lower()
        or batch["lifecycle"] != "ACTIVE"
        or participant["active"] is not True
        or participant["role"] not in allowed_roles
    ):
        return api_error(
            403, "OWNER_REQUIRED", "Active batch owner required"
        )

    return wallet, token_number, batch


@router.post("/{token_id}/documents")
def upload_document(
    token_id: str,
    request: Request,
    file: UploadFile = File(...),
    document_type: str = Form(alias="documentType"),
    visibility: str = Form(...)
):
    access = active_batch_owner(token_id, request)
    if isinstance(access, Response):
        return access
    wallet, token_number, batch = access

    if visibility not in ("PUBLIC", "RESTRICTED"):
        return api_error(
            400, "VALIDATION_ERROR", "Invalid visibility"
        )

    content = file.file.read(MAX_DOCUMENT_SIZE + 1)

    try:
        detected_type = validate_document(
            document_type,
            content,
            file.content_type, batch=batch
        )
    except ValueError as error:
        return api_error(
            400, "VALIDATION_ERROR", str(error)
        )

    restricted = visibility == "RESTRICTED"
    digest = hashlib.sha256(content).hexdigest()
    stored = content
    if restricted:
        try:
            stored = encrypt_document(content, token_number, document_type, wallet)
        except RuntimeError:
            return api_error(503, "RESTRICTED_UNAVAILABLE", "Document encryption unavailable")

    identity = (str(token_number), document_type, visibility, wallet, digest)
    pin_name = secrets.token_hex(16) + (".bin" if restricted else "." + FILE_EXTENSIONS[detected_type])
    try:
        with closing(sqlite3.connect(get_database_path())) as db, db:
            db.execute("BEGIN IMMEDIATE")
            intent = db.execute(
                "SELECT pin_name,stored_sha256 FROM document_uploads WHERE token_id=? AND "
                "document_type=? AND visibility=? AND uploaded_by=? AND sha256=?", identity
            ).fetchone()
            if not intent:
                db.execute("INSERT INTO document_uploads(token_id,document_type,visibility,uploaded_by,"
                           "sha256,pin_name,stored_sha256,uploaded_at) VALUES(?,?,?,?,?,?,?,?)",
                           (*identity, pin_name, hashlib.sha256(stored).hexdigest(), datetime.now(timezone.utc).isoformat()))
        if intent:
            pin_name, stored_hash = intent
            pin = recover_pin(pin_name, stored_hash)
            if not pin:
                return api_error(503, "STORAGE_UNAVAILABLE", "Previous pin has not been confirmed")
            result = {"cid": pin["cid"], "pinnedAt": pin["created_at"]}
        else:
            result = upload_public_document(stored, pin_name, "application/octet-stream" if restricted else detected_type)
        finish_upload(pin_name, result["cid"])
        result.update(encrypted=restricted, sha256=digest, contentType=detected_type, sizeBytes=len(content))
    except sqlite3.Error:
        return api_error(503, "STORAGE_UNAVAILABLE", "Upload record unavailable; retry to reconcile the same file")
    except (UploadNotStarted, requests.ConnectTimeout):
        if not intent:
            with closing(sqlite3.connect(get_database_path())) as db, db:
                db.execute("DELETE FROM document_uploads WHERE pin_name=?", (pin_name,))
        return api_error(502, "PINATA_UPLOAD_FAILED", "Upload could not start")
    except (requests.RequestException, RuntimeError, ValueError, KeyError, TypeError):
        return api_error(502, "PINATA_UPLOAD_FAILED", "Document pin could not be confirmed")

    return JSONResponse(
        status_code=201,
        content={
            "data": {
                "tokenId": str(token_number),
                "documentType": document_type,
                "visibility": visibility,
                **result,
                "status": "UPLOADED_NOT_LINKED"
            },
            "meta": {
                "requestId": f"req_{secrets.token_hex(8)}"
            }
        }
    )


def recover_pin(pin_name, stored_hash):
    for pin in list_pins({"name": pin_name}):
        if pin["name"] == pin_name:
            data = download_public_document(pin["cid"], max_bytes=MAX_DOCUMENT_SIZE + OVERHEAD)
            if hashlib.sha256(data).hexdigest() == stored_hash:
                return pin
    return None


def finish_upload(pin_name, cid):
    with closing(sqlite3.connect(get_database_path())) as db, db:
        db.execute("INSERT INTO documents(token_id,document_type,cid,sha256,visibility,encrypted,"
                   "uploaded_by,uploaded_at) SELECT token_id,document_type,?,sha256,visibility,"
                   "visibility='RESTRICTED',uploaded_by,uploaded_at FROM document_uploads WHERE pin_name=?",
                   (cid, pin_name))
        db.execute("DELETE FROM document_uploads WHERE pin_name=?", (pin_name,))


def parse_document_token_id(token_id: str) -> int:
    if not re.fullmatch(r"[0-9]{1,78}", token_id):
        raise ValueError("Invalid token ID")

    number = int(token_id)

    if number <= 0 or number >= 2**256:
        raise ValueError("Invalid token ID")

    return number


def find_document_record(
    token_id: int,
    document_type: str,
    cid: str
):
    with closing(sqlite3.connect(get_database_path())) as connection:
        return connection.execute(
            """
            SELECT visibility, encrypted, sha256, uploaded_by
            FROM documents
            WHERE token_id = ?
              AND document_type = ?
              AND cid = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (str(token_id), document_type, cid)
        ).fetchone()


@router.get("/{token_id}/documents")
def list_documents(token_id: str):
    try:
        token_number = parse_document_token_id(token_id)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")

    records = []

    try:
        for document_type in (
            "CERTIFICATE_OF_ORIGIN",
            "QUALITY_CERTIFICATE",
            "CHEMICAL_METADATA"
        ):
            chain_document = get_chain_document(
                token_number,
                document_type
            )

            cid = chain_document["cid"]

            if not cid:
                continue

            saved = find_document_record(
                token_number,
                document_type,
                cid
            )

            records.append({
                "documentType": document_type,
                "cid": cid,
                "visibility": saved[0] if saved else "UNKNOWN",
                "status": "LINKED",
                "updatedBy": chain_document["updated_by"],
                "updatedAt": chain_document["updated_at"]
            })

    except sqlite3.Error:
        return api_error(
            503, "STORAGE_UNAVAILABLE", "Cannot read document records"
        )
    except Exception:
        return api_error(
            503, "CHAIN_UNAVAILABLE", "Cannot read document references"
        )

    return {
        "data": records,
        "meta": {
            "requestId": f"req_{secrets.token_hex(8)}"
        }
    }


@router.get("/{token_id}/documents/pending")
def recover_document(token_id: str, documentType: str, request: Request, visibility: str = "PUBLIC"):
    access = active_batch_owner(token_id, request, require_origin=True)
    if isinstance(access, Response):
        return access
    wallet, token_number, _ = access
    if visibility not in ("PUBLIC", "RESTRICTED"):
        return api_error(400, "VALIDATION_ERROR", "Invalid visibility")
    if documentType not in DOCUMENT_TYPE_IDS:
        return api_error(400, "VALIDATION_ERROR", "Invalid document type")

    try:
        reference = get_chain_document(token_number, documentType)
        linked = reference["cid"]
    except Exception:
        return api_error(503, "CHAIN_UNAVAILABLE", "Cannot verify linked CID")

    try:
        with closing(sqlite3.connect(get_database_path())) as connection:
            attempt = connection.execute(
                "SELECT pin_name,stored_sha256 FROM document_uploads WHERE token_id=? AND document_type=? "
                "AND visibility=? AND uploaded_by=? COLLATE NOCASE ORDER BY uploaded_at DESC LIMIT 1",
                (str(token_number), documentType, visibility, wallet)
            ).fetchone()
            if attempt:
                pin = recover_pin(*attempt)
                if not pin:
                    return api_error(503, "PIN_UNCONFIRMED", "Previous upload has not been confirmed")
                finish_upload(attempt[0], pin["cid"])
            candidates = connection.execute(
                """
                SELECT cid FROM documents
                WHERE token_id = ? AND document_type = ?
                  AND uploaded_by = ? COLLATE NOCASE
                  AND visibility = ? AND encrypted = ?
                  AND cid != ? AND cid != ''
                ORDER BY id DESC
                """,
                (str(token_number), documentType, wallet, visibility, visibility == "RESTRICTED", linked)
            ).fetchall()
    except (requests.RequestException, RuntimeError, ValueError, KeyError, TypeError):
        return api_error(502, "PINATA_LOOKUP_FAILED", "Cannot reconcile previous upload")
    except sqlite3.Error:
        return api_error(503, "STORAGE_UNAVAILABLE", "Cannot read document records")
    try:
        history = set()
        if candidates and linked:
            history = linked_document_cids(token_number, DOCUMENT_TYPE_IDS[documentType], reference)
    except Exception:
        return api_error(503, "LINK_HISTORY_UNAVAILABLE", "Cannot verify historical links. Retry after index synchronization.")
    pending = next((cid for cid, in candidates if cid not in history), None)
    return JSONResponse({"data": {"cid": pending} if pending else None},
                        headers={"Cache-Control": "no-store"})


@router.get("/{token_id}/documents/{document_type}/content")
def get_document_content(token_id: str, document_type: str, request: Request):
    try:
        token_number = parse_document_token_id(token_id)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")

    if document_type not in (
        "CERTIFICATE_OF_ORIGIN",
        "QUALITY_CERTIFICATE",
        "CHEMICAL_METADATA"
    ):
        return api_error(400, "VALIDATION_ERROR", "Invalid document type")

    try:
        chain_document = get_chain_document(
            token_number,
            document_type
        )
    except Exception:
        return api_error(
            503, "CHAIN_UNAVAILABLE", "Cannot verify linked CID"
        )

    cid = chain_document["cid"]

    if not cid:
        return api_error(
            404, "DOCUMENT_NOT_FOUND", "No linked document"
        )

    try:
        saved = find_document_record(
            token_number,
            document_type,
            cid
        )
    except sqlite3.Error:
        return api_error(
            503, "STORAGE_UNAVAILABLE", "Cannot read document record"
        )

    if saved is None:
        return api_error(
            404,
            "DOCUMENT_NOT_AVAILABLE",
            "No verified local record for this CID"
        )

    visibility, encrypted, expected_hash, issuer = saved
    restricted = visibility == "RESTRICTED" and encrypted == 1
    if restricted:
        wallet = get_session_wallet(request)
        if not wallet or not allowed_origin(request):
            return api_error(403, "DOCUMENT_RESTRICTED", "Authorized wallet required")
        try:
            participant = get_participant(wallet)
            owner = get_token_owner(token_number)
            batch = get_medicine(token_number)
        except Exception:
            return api_error(503, "CHAIN_UNAVAILABLE", "Cannot verify document access")
        is_issuer = wallet.lower() == issuer.lower() == chain_document["updated_by"].lower()
        is_owner = (owner and owner.lower() == wallet.lower() and batch
                    and batch["lifecycle"] == "ACTIVE"
                    and participant["role"] in STAGE_ROLES.get(batch["stage"], set()))
        if (not participant["active"] or participant["role"] not in
                {"MANUFACTURER", "DISTRIBUTOR", "PHARMACY", "HOSPITAL"}
                or not (is_issuer or is_owner)):
            return api_error(403, "DOCUMENT_RESTRICTED", "Document access denied")
    elif visibility != "PUBLIC" or encrypted:
        return api_error(403, "DOCUMENT_RESTRICTED", "Document access denied")

    try:
        if restricted:
            envelope = download_public_document(cid, max_bytes=MAX_DOCUMENT_SIZE + OVERHEAD)
            content = decrypt_document(envelope, token_number, document_type, issuer)
        else:
            content = download_public_document(cid)

        detected_type = validate_document(
            document_type,
            content
        )

    except (requests.RequestException, RuntimeError, ValueError):
        return api_error(
            502, "IPFS_FETCH_FAILED", "Cannot retrieve a valid IPFS document"
        )

    actual_hash = hashlib.sha256(content).hexdigest()

    if actual_hash != expected_hash:
        return api_error(
            502,
            "DOCUMENT_INTEGRITY_FAILED",
            "Document SHA-256 does not match"
        )

    extension = FILE_EXTENSIONS[detected_type]
    filename = f"batch-{token_number}-{document_type.lower()}.{extension}"

    return Response(
        content=content,
        media_type=detected_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-SHA256": actual_hash,
            "X-Content-CID": cid,
            "Cache-Control": "no-store"
        }
    )
