
import hashlib
import json
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient
from pathlib import Path
from app.api import documents
from app.core.database import init_database
from app.main import app


WALLET = "0x0135b764190A75D879d0946EA80D9F9F82AB75ac"
PDF_CONTENT = b"%PDF-1.4\n1 0 obj\nendobj\n%%EOF"


@pytest.fixture
def document_client(tmp_path, monkeypatch):
    db_path = tmp_path / "documents_test.db"
    init_database(db_path)

    monkeypatch.setattr(
        documents, "get_database_path", lambda: db_path
    )

    monkeypatch.setattr(
        documents, "get_session_wallet", lambda request: WALLET
    )

    monkeypatch.setattr(
        documents, "get_token_owner", lambda token_id: WALLET
    )

    monkeypatch.setattr(
        documents,
        "get_medicine",
        lambda token_id: {
            "lifecycle": "ACTIVE",
            "stage": "AT_MANUFACTURER",
            "gtin": "09506000134352", "batch_number": "LOT-2026-0001"
        }
    )

    monkeypatch.setattr(
        documents,
        "get_participant",
        lambda wallet: {
            "role": "MANUFACTURER",
            "active": True
        }
    )

    uploads = []

    def fake_upload(content, filename, content_type):
        uploads.append(content)
        return {
            "cid": "bafy-test-document",
            "sha256": hashlib.sha256(content).hexdigest(),
            "sizeBytes": len(content),
            "contentType": content_type,
            "pinnedAt": "2026-11-21T00:00:00Z",
            "encrypted": False
        }

    monkeypatch.setattr(
        documents, "upload_public_document", fake_upload
    )

    return TestClient(app, headers={"Origin": "http://localhost:5173"}), db_path, uploads


def send_document(client, content=PDF_CONTENT, visibility="PUBLIC"):
    return client.post(
        "/api/v1/batches/1/documents",
        headers={"Origin": "http://localhost:5173"},
        data={
            "documentType": "CERTIFICATE_OF_ORIGIN",
            "visibility": visibility
        },
        files={
            "file": ("certificate.pdf", content, "application/pdf")
        }
    )


def test_document_upload_success(document_client):
    client, db_path, uploads = document_client

    response = send_document(client)

    assert response.status_code == 201

    data = response.json()["data"]

    assert data["cid"] == "bafy-test-document"
    assert data["encrypted"] is False
    assert data["status"] == "UPLOADED_NOT_LINKED"
    assert data["sha256"] == hashlib.sha256(PDF_CONTENT).hexdigest()
    assert len(uploads) == 1

    with closing(sqlite3.connect(db_path)) as connection:
        saved = connection.execute(
            """
            SELECT cid, visibility, contract_tx_hash
            FROM documents
            """
        ).fetchone()

    assert saved == ("bafy-test-document", "PUBLIC", None)


def test_document_requires_session(document_client, monkeypatch):
    client, _, uploads = document_client

    monkeypatch.setattr(
        documents, "get_session_wallet", lambda request: None
    )

    response = send_document(client)

    assert response.status_code == 401
    assert len(uploads) == 0


def test_document_requires_owner(document_client, monkeypatch):
    client, _, uploads = document_client

    monkeypatch.setattr(
        documents,
        "get_token_owner",
        lambda token_id: "0x0000000000000000000000000000000000000001"
    )

    response = send_document(client)

    assert response.status_code == 403
    assert len(uploads) == 0


def test_document_rejects_inactive_role(document_client, monkeypatch):
    client, _, uploads = document_client

    monkeypatch.setattr(
        documents,
        "get_participant",
        lambda wallet: {
            "role": "MANUFACTURER",
            "active": False
        }
    )

    response = send_document(client)

    assert response.status_code == 403
    assert len(uploads) == 0


def test_document_rejects_invalid_file(document_client):
    client, _, uploads = document_client

    response = send_document(client, b"Not a PDF")

    assert response.status_code == 400
    assert len(uploads) == 0


def test_document_rejects_restricted_until_encrypted(document_client):
    client, _, uploads = document_client

    response = send_document(
        client,
        visibility="RESTRICTED"
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "RESTRICTED_UNAVAILABLE"
    assert len(uploads) == 0

@pytest.mark.parametrize(
    "document_type,filename,content_type",
    [
        (
            "CERTIFICATE_OF_ORIGIN",
            "certificate-of-origin.pdf",
            "application/pdf"
        ),
        (
            "QUALITY_CERTIFICATE",
            "coa-scan.png",
            "image/png"
        ),
        (
            "CHEMICAL_METADATA",
            "chemical-metadata.json",
            "application/json"
        )
    ]
)
def test_document_roundtrip_with_chain_mock(
    document_client,
    monkeypatch,
    document_type,
    filename,
    content_type
):
    client, db_path, uploads = document_client

    path = (
        Path(__file__).resolve().parents[2]
        / "sample-data"
        / "documents"
        / filename
    )
    content = path.read_bytes()

    response = client.post(
        "/api/v1/batches/1/documents",
        headers={"Origin": "http://localhost:5173"},
        data={
            "documentType": document_type,
            "visibility": "PUBLIC"
        },
        files={
            "file": (filename, content, content_type)
        }
    )

    assert response.status_code == 201, response.text

    result = response.json()["data"]

    assert result["status"] == "UPLOADED_NOT_LINKED"
    assert result["contentType"] == content_type
    assert result["sha256"] == hashlib.sha256(content).hexdigest()
    assert uploads == [content]

    url = (
        f"/api/v1/batches/1/documents/"
        f"{document_type}/content"
    )

    monkeypatch.setattr(
        documents,
        "get_chain_document",
        lambda token_id, doc_type: {"cid": ""}
    )

    before_link = client.get(url)
    assert before_link.status_code == 404

    monkeypatch.setattr(
        documents,
        "get_chain_document",
        lambda token_id, doc_type: {"cid": result["cid"]}
    )

    monkeypatch.setattr(
        documents,
        "download_public_document",
        lambda cid: content
    )

    after_link = client.get(url)

    assert after_link.status_code == 200
    assert after_link.content == content
    assert after_link.headers["content-type"] == content_type
    assert after_link.headers["x-content-sha256"] == result["sha256"]

    with closing(sqlite3.connect(db_path)) as connection:
        saved = connection.execute(
            """
            SELECT cid, contract_tx_hash
            FROM documents
            WHERE document_type = ?
            """,
            (document_type,)
        ).fetchone()

    assert saved == (result["cid"], None)

@pytest.mark.parametrize("field,value", [("gtin", "09506000134353"), ("batchNumber", "OTHER")])
def test_chemical_document_must_match_token(document_client, field, value):
    client, db, uploads = document_client
    sample = Path(__file__).resolve().parents[2] / "sample-data/documents/chemical-metadata.json"
    payload = json.loads(sample.read_bytes())
    payload[field] = value
    response = client.post("/api/v1/batches/1/documents",
                           data={"documentType": "CHEMICAL_METADATA", "visibility": "PUBLIC"},
                           files={"file": ("data.json", json.dumps(payload).encode(), "application/json")})
    assert response.status_code == 400
    assert not uploads
    with closing(sqlite3.connect(db)) as connection:
        assert connection.execute("SELECT COUNT(*) FROM document_uploads").fetchone() == (0,)


def test_pinata_failure_does_not_save_document(
    document_client,
    monkeypatch
):
    client, db_path, _ = document_client

    def fail_upload(content, filename, content_type):
        raise documents.requests.Timeout("Pinata timeout")

    monkeypatch.setattr(
        documents,
        "upload_public_document",
        fail_upload
    )

    response = send_document(client)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PINATA_UPLOAD_FAILED"

    with closing(sqlite3.connect(db_path)) as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM documents"
        ).fetchone()[0]

    assert count == 0


PENDING = "/api/v1/batches/1/documents/pending?documentType=CERTIFICATE_OF_ORIGIN"


def test_pending_after_reload_then_link(document_client, monkeypatch):
    client, _, uploads = document_client
    cid = send_document(client).json()["data"]["cid"]
    monkeypatch.setattr(documents, "get_chain_document", lambda *_: {"cid": ""})
    assert client.get(PENDING).json()["data"] == {"cid": cid}
    monkeypatch.setattr(documents, "get_chain_document", lambda *_: {"cid": cid})
    assert client.get(PENDING).json()["data"] is None
    assert uploads == [PDF_CONTENT]


@pytest.mark.parametrize("service,value,status", [
    ("get_session_wallet", None, 401),
    ("get_token_owner", "other-owner", 403),
    ("get_participant", {"role": "MANUFACTURER", "active": False}, 403),
    ("get_participant", {"role": "HOSPITAL", "active": True}, 403),
])
@pytest.mark.parametrize("visibility", ["PUBLIC", "RESTRICTED"])
def test_pending_requires_owner_role(document_client, monkeypatch, service, value, status, visibility):
    client, _, _ = document_client
    monkeypatch.setattr(documents, service, lambda *_: value)
    assert client.get(PENDING + "&visibility=" + visibility).status_code == status


@pytest.mark.parametrize("visibility", ["PUBLIC", "RESTRICTED"])
def test_pending_origin_and_rpc_failure(document_client, monkeypatch, visibility):
    client, _, _ = document_client
    path = PENDING + "&visibility=" + visibility
    assert client.get(path, headers={"Origin": "https://invalid.example"}).status_code == 403
    del client.headers["origin"]
    assert client.get(path).status_code == 403
    client.headers["origin"] = "http://localhost:5173"
    def unavailable(*_):
        raise TimeoutError()
    monkeypatch.setattr(documents, "get_chain_document", unavailable)
    assert client.get(path).status_code == 503


def test_same_origin_browser_recovers_without_origin_header(document_client, monkeypatch):
    client, _, _ = document_client
    cid = send_document(client).json()["data"]["cid"]
    monkeypatch.setattr(documents, "get_chain_document", lambda *_: {"cid": ""})
    browser = TestClient(app, base_url="http://localhost:5173", headers={"Sec-Fetch-Site": "same-origin"})
    assert browser.get(PENDING).json()["data"] == {"cid": cid}
    assert browser.get(PENDING, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_restricted_ciphertext_and_access(document_client, monkeypatch):
    import base64
    import secrets
    from pydantic import SecretStr
    from app.core.config import settings

    client, _, uploads = document_client
    key = SecretStr(base64.b64encode(secrets.token_bytes(32)).decode())
    monkeypatch.setattr(settings, "document_key_v1", key)
    result = send_document(client, visibility="RESTRICTED").json()["data"]
    assert result["encrypted"] and PDF_CONTENT not in uploads[0]
    assert result["sha256"] == hashlib.sha256(PDF_CONTENT).hexdigest()
    monkeypatch.setattr(documents, "get_chain_document",
                        lambda *_: {"cid": result["cid"], "updated_by": WALLET})
    monkeypatch.setattr(documents, "download_public_document", lambda *_, **kwargs: uploads[0])
    url = "/api/v1/batches/1/documents/CERTIFICATE_OF_ORIGIN/content"
    assert client.get(url).content == PDF_CONTENT
    new_owner = "0x" + "a" * 40
    monkeypatch.setattr(documents, "get_token_owner", lambda *_: new_owner)
    assert client.get(url).content == PDF_CONTENT
    monkeypatch.setattr(documents, "get_session_wallet", lambda *_: new_owner)
    assert client.get(url).content == PDF_CONTENT
    uploads[0] = uploads[0][:-1] + bytes([uploads[0][-1] ^ 1])
    assert client.get(url).status_code == 502
    monkeypatch.setattr(documents, "get_session_wallet", lambda *_: "unrelated")
    assert client.get(url).status_code == 403
    monkeypatch.setattr(documents, "get_session_wallet", lambda *_: WALLET)
    monkeypatch.setattr(documents, "get_participant", lambda *_: {"active": False, "role": "NONE"})
    assert client.get(url).status_code == 403


@pytest.mark.parametrize("visibility", ["PUBLIC", "RESTRICTED"])
def test_recover_after_pin_succeeds_but_database_write_fails(document_client, monkeypatch, visibility):
    import base64
    import secrets
    from pydantic import SecretStr
    from app.core.config import settings

    monkeypatch.setattr(settings, "document_key_v1", SecretStr(base64.b64encode(secrets.token_bytes(32)).decode()))
    client, db, uploads = document_client
    with monkeypatch.context() as patch:
        def unavailable(*_):
            raise sqlite3.OperationalError("fixture")
        patch.setattr(documents, "finish_upload", unavailable)
        assert send_document(client, visibility=visibility).status_code == 503
    with closing(sqlite3.connect(db)) as conn:
        name, = conn.execute("SELECT pin_name FROM document_uploads").fetchone()
    monkeypatch.setattr(documents, "get_chain_document", lambda *_: {"cid": ""})
    monkeypatch.setattr(documents, "list_pins", lambda params: [{"name": name, "cid": "recovered"}])
    monkeypatch.setattr(documents, "download_public_document", lambda *_, **kwargs: uploads[0])
    assert client.get(PENDING + "&visibility=" + visibility).json()["data"] == {"cid": "recovered"}
    if visibility == "PUBLIC":
        assert uploads == [PDF_CONTENT]
    else:
        assert len(uploads) == 1 and PDF_CONTENT not in uploads[0]
    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("SELECT COUNT(*) FROM document_uploads").fetchone() == (0,)
