
import hashlib
import json

import requests

from app.core.config import settings
import re
from app.services.document_service import MAX_DOCUMENT_SIZE

PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files"


class UploadNotStarted(RuntimeError):
    pass


def metadata_bytes(metadata):
    return json.dumps(
        metadata,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":")
    ).encode("utf-8")


def pin_file(content: bytes, filename: str, content_type: str):
    if not settings.pinata_jwt.strip():
        raise UploadNotStarted("PINATA_JWT is missing")
    response = requests.post(
        PINATA_UPLOAD_URL,
        headers={
            "Authorization": f"Bearer {settings.pinata_jwt}"
        },
        data={
            "network": "public",
            "name": filename,
            "cid_version": "v1"
        },
        files={
            "file": (filename, content, content_type)
        },
        allow_redirects=False,
        timeout=30
    )

    if response.status_code in (400, 401, 403, 413, 415, 422, 429):
        raise UploadNotStarted("Pinata rejected the upload")
    response.raise_for_status()
    if not 200 <= response.status_code < 300:
        raise RuntimeError("Unexpected Pinata upload status")

    result = response.json().get("data")

    if not isinstance(result, dict):
        raise RuntimeError("Invalid Pinata response")

    cid = result.get("cid")
    created_at = result.get("created_at")

    if not isinstance(cid, str) or not cid:
        raise RuntimeError("Pinata response missing CID")

    if not isinstance(created_at, str) or not created_at:
        raise RuntimeError("Pinata response missing creation time")

    return cid, created_at


def upload_nft_metadata(metadata: dict, filename: str) -> dict:
    content = metadata_bytes(metadata)
    cid, created_at = pin_file(content, filename, "application/json")
    return {
        "metadataCID": cid,
        "uri": f"ipfs://{cid}",
        "contentType": "application/json",
        "sha256": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
        "pinnedAt": created_at
    }


def upload_public_document(
    content: bytes,
    filename: str,
    content_type: str
) -> dict:
    cid, created_at = pin_file(content, filename, content_type)
    return {
        "cid": cid,
        "sha256": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
        "contentType": content_type,
        "pinnedAt": created_at,
        "encrypted": False
    }

def download_public_document(cid: str, *, max_bytes: int = MAX_DOCUMENT_SIZE) -> bytes:
    if not re.fullmatch(r"[A-Za-z0-9]{20,120}", cid):
        raise ValueError("Invalid IPFS CID")

    url = (
        f"https://gateway.pinata.cloud/ipfs/{cid}"
    )

    response = requests.get(
        url,
        timeout=(5, 30),
        stream=True,
        allow_redirects=False
    )

    try:
        if response.status_code != 200:
            response.raise_for_status()
            raise RuntimeError("Unexpected IPFS gateway status")

        content = bytearray()

        for chunk in response.iter_content(chunk_size=65536):
            content.extend(chunk)

            if len(content) > max_bytes:
                raise ValueError("Downloaded document exceeds size limit")

        return bytes(content)
    finally:
        response.close()


def recover_nft_metadata(metadata, filename, legacy=False):
    import base64

    expected = metadata_bytes(metadata)
    digest = hashlib.sha256(expected).digest()
    raw_cid = "b" + base64.b32encode(bytes.fromhex("01551220") + digest).decode().lower().rstrip("=")
    entries = list_pins({"cid": raw_cid} if legacy else {"name": filename})
    for entry in entries:
        if not legacy and entry.get("name") != filename:
            continue
        cid, pinned_at = entry["cid"], entry["created_at"]
        if not pinned_at or (legacy and cid != raw_cid):
            continue
        if download_public_document(cid, max_bytes=len(expected)) == expected:
            return {"metadataCID": cid, "uri": f"ipfs://{cid}", "contentType": "application/json",
                    "sha256": digest.hex(), "sizeBytes": len(expected), "pinnedAt": pinned_at}
    return None


def list_pins(params):
    if not settings.pinata_jwt.strip():
        raise RuntimeError("Pinata unavailable")
    response = requests.get(
        "https://api.pinata.cloud/v3/files/public",
        params=params,
        headers={"Authorization": f"Bearer {settings.pinata_jwt}"},
        timeout=(5, 15), allow_redirects=False
    )
    response.raise_for_status()
    return response.json()["data"]["files"]
