
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api import metadata as metadata_api
from app.core.database import init_database
from app.main import app


WALLET = "0x0135b764190A75D879d0946EA80D9F9F82AB75ac"

TODAY = datetime.now(timezone.utc).date()
PAYLOAD = {
    "gtin": "03459876012345",
    "batchNumber": "BT-2026-001",
    "medicineName": "Amoxicillin 500mg",
    "manufactureDate": str(TODAY - timedelta(days=1)),
    "expiryDate": str(TODAY + timedelta(days=365))
}


@pytest.fixture
def metadata_client(tmp_path, monkeypatch):
    db_path = tmp_path / "metadata_test.db"
    init_database(db_path)

    monkeypatch.setattr(
        metadata_api,
        "get_database_path",
        lambda: db_path
    )

    monkeypatch.setattr(
        metadata_api,
        "get_session_wallet",
        lambda request: WALLET
    )

    monkeypatch.setattr(
        metadata_api,
        "get_participant",
        lambda wallet: {
            "wallet": wallet,
            "role": "MANUFACTURER",
            "organization_name": "DSCT Manufacturer",
            "active": True
        }
    )

    uploads = []

    def fake_upload(metadata, filename):
        uploads.append(metadata)
        return {
            "metadataCID": "bafy-test-cid",
            "uri": "ipfs://bafy-test-cid",
            "contentType": "application/json",
            "sha256": "a" * 64,
            "sizeBytes": 512,
            "pinnedAt": "2026-11-21T00:00:00Z"
        }

    monkeypatch.setattr(
        metadata_api,
        "upload_nft_metadata",
        fake_upload
    )

    return TestClient(app), uploads


def send_metadata(client, payload, key):
    return client.post(
        "/api/v1/metadata/medicine-batches",
        json=payload,
        headers={
            "Origin": "http://localhost:5173",
            "Idempotency-Key": key
        }
    )


def test_create_metadata_success(metadata_client):
    client, uploads = metadata_client

    response = send_metadata(client, PAYLOAD, str(uuid4()))

    assert response.status_code == 201
    assert response.json()["data"]["metadataCID"] == "bafy-test-cid"
    assert response.json()["data"]["uri"] == "ipfs://bafy-test-cid"
    assert len(uploads) == 1
    assert uploads[0]["attributes"][4]["value"] == "DSCT Manufacturer"


def test_metadata_idempotency(metadata_client):
    client, uploads = metadata_client
    key = str(uuid4())

    first = send_metadata(client, PAYLOAD, key)
    second = send_metadata(client, PAYLOAD, key)

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["data"] == second.json()["data"]
    assert len(uploads) == 1


def test_metadata_key_conflict(metadata_client):
    client, uploads = metadata_client
    key = str(uuid4())

    first = send_metadata(client, PAYLOAD, key)

    changed = {
        **PAYLOAD,
        "medicineName": "Another medicine"
    }

    second = send_metadata(client, changed, key)

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert len(uploads) == 1


def test_metadata_requires_manufacturer(metadata_client, monkeypatch):
    client, uploads = metadata_client

    monkeypatch.setattr(
        metadata_api,
        "get_participant",
        lambda wallet: {
            "role": "NONE",
            "active": False
        }
    )

    response = send_metadata(client, PAYLOAD, str(uuid4()))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "MANUFACTURER_ROLE_REQUIRED"
    assert len(uploads) == 0


def test_metadata_requires_auth(metadata_client, monkeypatch):
    client, uploads = metadata_client

    monkeypatch.setattr(
        metadata_api,
        "get_session_wallet",
        lambda request: None
    )

    response = send_metadata(client, PAYLOAD, str(uuid4()))

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
    assert len(uploads) == 0


def test_metadata_rejects_invalid_gtin(metadata_client):
    client, uploads = metadata_client

    invalid = {
        **PAYLOAD,
        "gtin": "123"
    }

    response = send_metadata(client, invalid, str(uuid4()))

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert len(uploads) == 0


def test_metadata_blocking_work_uses_worker_thread(metadata_client, monkeypatch):
    client, _ = metadata_client
    upload = metadata_api.upload_nft_metadata

    def checked_upload(*args):
        with pytest.raises(RuntimeError, match="no running event loop"):
            asyncio.get_running_loop()
        return upload(*args)

    monkeypatch.setattr(metadata_api, "upload_nft_metadata", checked_upload)
    assert send_metadata(client, PAYLOAD, str(uuid4())).status_code == 201


def test_lost_response_reconciles_without_second_upload(metadata_client, monkeypatch):
    client, _ = metadata_client
    key = str(uuid4())
    pinned = {}
    def lost(meta, name):
        assert not pinned
        pinned[name] = meta
        raise metadata_api.requests.ReadTimeout()
    monkeypatch.setattr(metadata_api, "upload_nft_metadata", lost)
    def reconcile(meta, name, legacy):
        assert not legacy and pinned[name] == meta
        return {"metadataCID": "fixture"}
    monkeypatch.setattr(metadata_api, "recover_nft_metadata", reconcile)
    assert send_metadata(client, PAYLOAD, key).status_code == 502
    assert send_metadata(client, PAYLOAD, key).json()["data"]["metadataCID"] == "fixture"
    assert send_metadata(client, PAYLOAD, key).status_code == 200
