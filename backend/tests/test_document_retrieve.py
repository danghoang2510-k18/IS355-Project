
import hashlib
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.api import documents
from app.core.database import init_database
from app.main import app


WALLET = "0x0135b764190A75D879d0946EA80D9F9F82AB75ac"
CID = "bafy-test-document"
PDF_CONTENT = b"%PDF-1.4\n1 0 obj\nendobj\n%%EOF"


@pytest.fixture
def retrieve_client(tmp_path, monkeypatch):
    db_path = tmp_path / "retrieve_test.db"
    init_database(db_path)

    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            connection.execute(
                """
                INSERT INTO documents (
                    token_id, document_type, cid, sha256,
                    visibility, encrypted, uploaded_by,
                    uploaded_at, contract_tx_hash
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    "1",
                    "CERTIFICATE_OF_ORIGIN",
                    CID,
                    hashlib.sha256(PDF_CONTENT).hexdigest(),
                    "PUBLIC",
                    0,
                    WALLET,
                    "2026-11-21T00:00:00Z"
                )
            )

    monkeypatch.setattr(
        documents, "get_database_path", lambda: db_path
    )

    def fake_chain_document(token_id, document_type):
        return {
            "cid": CID if document_type == "CERTIFICATE_OF_ORIGIN" else "",
            "updated_by": WALLET,
            "updated_at": 1763683200
        }

    monkeypatch.setattr(
        documents, "get_chain_document", fake_chain_document
    )

    monkeypatch.setattr(
        documents,
        "download_public_document",
        lambda cid: PDF_CONTENT
    )

    return TestClient(app), db_path


def test_list_linked_documents(retrieve_client):
    client, _ = retrieve_client

    response = client.get("/api/v1/batches/1/documents")

    assert response.status_code == 200

    records = response.json()["data"]

    assert len(records) == 1
    assert records[0]["cid"] == CID
    assert records[0]["visibility"] == "PUBLIC"
    assert records[0]["status"] == "LINKED"


def test_download_public_document(retrieve_client):
    client, _ = retrieve_client

    response = client.get(
        "/api/v1/batches/1/documents/CERTIFICATE_OF_ORIGIN/content"
    )

    assert response.status_code == 200
    assert response.content == PDF_CONTENT
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-content-cid"] == CID
    assert response.headers["x-content-sha256"] == hashlib.sha256(
        PDF_CONTENT
    ).hexdigest()


def test_unlinked_document_not_available(retrieve_client, monkeypatch):
    client, _ = retrieve_client

    monkeypatch.setattr(
        documents,
        "get_chain_document",
        lambda token_id, document_type: {"cid": ""}
    )

    response = client.get(
        "/api/v1/batches/1/documents/CERTIFICATE_OF_ORIGIN/content"
    )

    assert response.status_code == 404


def test_different_onchain_cid_not_trusted(retrieve_client, monkeypatch):
    client, _ = retrieve_client

    monkeypatch.setattr(
        documents,
        "get_chain_document",
        lambda token_id, document_type: {"cid": "another-cid"}
    )

    response = client.get(
        "/api/v1/batches/1/documents/CERTIFICATE_OF_ORIGIN/content"
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DOCUMENT_NOT_AVAILABLE"


def test_restricted_document_not_public(retrieve_client):
    client, db_path = retrieve_client

    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            connection.execute(
                """
                UPDATE documents
                SET visibility = 'RESTRICTED', encrypted = 1
                """
            )

    response = client.get(
        "/api/v1/batches/1/documents/CERTIFICATE_OF_ORIGIN/content"
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "DOCUMENT_RESTRICTED"


def test_download_detects_integrity_failure(retrieve_client, monkeypatch):
    client, _ = retrieve_client

    monkeypatch.setattr(
        documents,
        "download_public_document",
        lambda cid: b"%PDF-1.4\nchanged\n%%EOF"
    )

    response = client.get(
        "/api/v1/batches/1/documents/CERTIFICATE_OF_ORIGIN/content"
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "DOCUMENT_INTEGRITY_FAILED"
