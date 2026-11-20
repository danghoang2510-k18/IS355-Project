
import hashlib
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import auth
from app.core.database import init_database
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import Request
WALLET = "0x0135b764190A75D879d0946EA80D9F9F82AB75ac"
ORIGIN = "http://localhost:5173"


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    db_path = tmp_path / "auth_test.db"
    init_database(db_path)

    monkeypatch.setattr(
        auth,
        "get_database_path",
        lambda: db_path
    )

    return TestClient(app), db_path


def test_nonce_success(auth_client):
    client, db_path = auth_client

    response = client.post(
        "/api/v1/auth/nonce",
        json={"address": WALLET, "chainId": 11155111},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 200

    data = response.json()["data"]

    assert data["nonce"]
    assert "Chain ID: 11155111" in data["message"]
    assert "Domain: localhost:5173" in data["message"]
    assert f"Nonce: {data['nonce']}" in data["message"]
    assert data["expiresAt"]

    expected_hash = hashlib.sha256(
        data["nonce"].encode("utf-8")
    ).hexdigest()

    with closing(sqlite3.connect(db_path)) as connection:
        saved_hash = connection.execute(
            "SELECT nonce_hash FROM auth_nonces"
        ).fetchone()[0]

    assert saved_hash == expected_hash


def test_reject_wrong_chain(auth_client):
    client, _ = auth_client

    response = client.post(
        "/api/v1/auth/nonce",
        json={"address": WALLET, "chainId": 1},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_reject_wrong_origin(auth_client):
    client, _ = auth_client

    response = client.post(
        "/api/v1/auth/nonce",
        json={"address": WALLET, "chainId": 11155111},
        headers={"Origin": "https://other-site.example"}
    )

    assert response.status_code == 403


def test_nonce_is_unique(auth_client):
    client, _ = auth_client

    nonces = []

    for _ in range(2):
        response = client.post(
            "/api/v1/auth/nonce",
            json={"address": WALLET, "chainId": 11155111},
            headers={"Origin": ORIGIN}
        )
        assert response.status_code == 200
        nonces.append(response.json()["data"]["nonce"])

    assert nonces[0] != nonces[1]


def test_nonce_rate_limit(auth_client):
    client, _ = auth_client

    for _ in range(5):
        response = client.post(
            "/api/v1/auth/nonce",
            json={"address": WALLET, "chainId": 11155111},
            headers={"Origin": ORIGIN}
        )
        assert response.status_code == 200

    response = client.post(
        "/api/v1/auth/nonce",
        json={"address": WALLET, "chainId": 11155111},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"

def test_nonce_quota_is_scoped_to_transport_peer(auth_client):
    client, _ = auth_client
    account = Account.create()
    body = {"address": account.address, "chainId": 11155111}
    for _ in range(5):
        assert client.post("/api/v1/auth/nonce", json=body).status_code == 200
    assert client.post("/api/v1/auth/nonce", json=body,
                       headers={"X-Forwarded-For": "192.0.2.7"}).status_code == 429
    peer = TestClient(app, client=("192.0.2.7", 51234))
    message = request_challenge(peer, account.address)
    signed = {"message": message, "signature": sign_message(account, message)}
    assert peer.post("/api/v1/auth/verify", json=signed).status_code == 200
    assert peer.post("/api/v1/auth/verify", json=signed).status_code == 401
    assert peer.post("/api/v1/auth/logout").status_code == 200


def sign_message(account, message):
    signed = Account.sign_message(
        encode_defunct(text=message),
        private_key=account.key
    )
    return signed.signature.hex()


def request_challenge(client, wallet):
    response = client.post(
        "/api/v1/auth/nonce",
        json={
            "address": wallet,
            "chainId": 11155111
        },
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 200
    return response.json()["data"]["message"]



def test_verify_success_and_logout(auth_client):
    client, db_path = auth_client
    account = Account.create()

    message = request_challenge(client, account.address)
    signature = sign_message(account, message)

    response = client.post(
        "/api/v1/auth/verify",
        json={"message": message, "signature": signature},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 200
    assert response.json()["data"]["address"] == account.address
    assert response.json()["data"]["chainId"] == 11155111
    assert "httponly" in response.headers["set-cookie"].lower()

    session_token = client.cookies.get("dsct_session")
    assert session_token is not None

    request = Request({
        "type": "http",
        "headers": [
            (b"cookie", f"dsct_session={session_token}".encode())
        ]
    })

    assert auth.get_session_wallet(request) == account.address

    with closing(sqlite3.connect(db_path)) as connection:
        session = connection.execute(
            "SELECT session_hash, revoked_at FROM auth_sessions"
        ).fetchone()

    assert session is not None
    assert session[1] is None

    logout = client.post(
        "/api/v1/auth/logout",
        headers={"Origin": ORIGIN}
    )

    assert logout.status_code == 200
    assert logout.json()["data"]["loggedOut"] is True

    with closing(sqlite3.connect(db_path)) as connection:
        revoked_at = connection.execute(
            "SELECT revoked_at FROM auth_sessions"
        ).fetchone()[0]

    assert revoked_at is not None
    assert auth.get_session_wallet(request) is None



def test_verify_rejects_replay(auth_client):
    client, _ = auth_client
    account = Account.create()

    message = request_challenge(client, account.address)
    signature = sign_message(account, message)

    payload = {"message": message, "signature": signature}

    first = client.post(
        "/api/v1/auth/verify",
        json=payload,
        headers={"Origin": ORIGIN}
    )

    second = client.post(
        "/api/v1/auth/verify",
        json=payload,
        headers={"Origin": ORIGIN}
    )

    assert first.status_code == 200
    assert second.status_code == 401
    assert second.json()["error"]["code"] == "NONCE_INVALID"


def test_verify_rejects_wrong_signature(auth_client):
    client, _ = auth_client

    account = Account.create()
    attacker = Account.create()

    message = request_challenge(client, account.address)
    signature = sign_message(attacker, message)

    response = client.post(
        "/api/v1/auth/verify",
        json={"message": message, "signature": signature},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_SIGNATURE"


def test_verify_rejects_wrong_domain(auth_client):
    client, _ = auth_client
    account = Account.create()

    message = request_challenge(client, account.address)

    modified = message.replace(
        "Domain: localhost:5173",
        "Domain: attacker.example"
    )

    signature = sign_message(account, modified)

    response = client.post(
        "/api/v1/auth/verify",
        json={"message": modified, "signature": signature},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 401


def test_verify_rejects_expired_nonce(auth_client):
    client, db_path = auth_client
    account = Account.create()

    message = request_challenge(client, account.address)
    signature = sign_message(account, message)

    with closing(sqlite3.connect(db_path)) as connection:
        with connection:
            connection.execute(
                "UPDATE auth_nonces SET expires_at = ?",
                ("2000-01-01T00:00:00Z",)
            )

    response = client.post(
        "/api/v1/auth/verify",
        json={"message": message, "signature": signature},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 401

def test_session_invalid_after_logout(auth_client):
    client, _ = auth_client
    account = Account.create()

    message = request_challenge(client, account.address)
    signature = sign_message(account, message)

    response = client.post(
        "/api/v1/auth/verify",
        json={"message": message, "signature": signature},
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 200

    session_token = client.cookies.get("dsct_session")
    assert session_token is not None

    request = Request({
        "type": "http",
        "headers": [
            (
                b"cookie",
                f"dsct_session={session_token}".encode()
            )
        ]
    })

    assert auth.get_session_wallet(request) == account.address

    response = client.post(
        "/api/v1/auth/logout",
        headers={"Origin": ORIGIN}
    )

    assert response.status_code == 200

    assert auth.get_session_wallet(request) is None
