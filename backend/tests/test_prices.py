import base64
import secrets
import sqlite3
import time
from contextlib import closing

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.api import documents, prices
from app.core.config import settings
from app.core.database import init_database
from app.main import app

SENDER = "0x" + "1" * 40
BUYER = "0x" + "2" * 40
PATH = "/api/v1/encryption/prices"
REF = {"tokenId": "1", "txHash": "0x" + "a" * 64}
BODY = {"tokenId": "1", "recipient": BUYER, "amount": "12345.67", "currency": "USD"}


@pytest.fixture
def market(monkeypatch, tmp_path):
    db = init_database(tmp_path / "prices.db")
    wallet = [SENDER]
    batch = {"lifecycle": "ACTIVE", "stage": "AT_MANUFACTURER", "expiry_date": time.time() + 3000}
    key = SecretStr(base64.b64encode(secrets.token_bytes(32)).decode())
    monkeypatch.setattr(settings, "price_key_v1", key)
    monkeypatch.setattr(prices, "get_database_path", lambda: db)
    for module in (documents, prices):
        monkeypatch.setattr(module, "get_session_wallet", lambda _: wallet[0])
        monkeypatch.setattr(module, "get_participant", lambda addr: {
            "active": True, "role": "DISTRIBUTOR" if addr == BUYER else "MANUFACTURER"})
    monkeypatch.setattr(documents, "get_medicine", lambda _: batch)
    monkeypatch.setattr(documents, "get_token_owner", lambda _: SENDER)
    return TestClient(app), wallet, db


def test_party_access_after_confirmation(market, monkeypatch):
    client, wallet, db = market
    result = client.post(PATH, json=BODY)
    assert result.status_code == 200, result.text
    encrypted = bytes.fromhex(result.json()["data"]["encryptedPrice"][2:])
    assert BODY["amount"].encode() not in encrypted
    assert 29 <= len(encrypted) <= 1024
    event = {"from": SENDER, "to": BUYER, "encryptedPrice": encrypted}
    monkeypatch.setattr(prices, "confirmed_transfer", lambda *_: None)
    assert client.post(PATH + "/decrypt", json=REF).status_code == 409
    monkeypatch.setattr(prices, "confirmed_transfer", lambda *_: event)
    for party in (SENDER, BUYER):
        wallet[0] = party
        response = client.post(PATH + "/decrypt", json=REF)
        assert response.json()["data"]["amount"] == BODY["amount"]
        assert response.headers["cache-control"] == "no-store"
    wallet[0] = "other"
    assert client.post(PATH + "/decrypt", json=REF).status_code == 403
    wallet[0] = SENDER
    event["to"] = "0x" + "3"*40
    assert client.post(PATH + "/decrypt", json=REF).status_code == 422
    event["to"] = BUYER
    event["encryptedPrice"] = encrypted[:-1] + bytes([encrypted[-1] ^ 1])
    assert client.post(PATH + "/decrypt", json=REF).status_code == 422
    event["encryptedPrice"] = encrypted
    monkeypatch.setattr(settings, "price_key_v1", SecretStr(base64.b64encode(secrets.token_bytes(32)).decode()))
    assert client.post(PATH + "/decrypt", json=REF).status_code == 422
    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("SELECT count(*) FROM price_key_access WHERE transfer_tx_hash=?",
                            (REF["txHash"],)).fetchone()[0] == 2
        assert conn.execute("SELECT outcome FROM audit_logs ORDER BY id").fetchall() == [
            ("ALLOWED",), ("ALLOWED",), ("DENIED",)]


def test_invalid_route_and_owner(market):
    client, wallet, _ = market
    assert client.post(PATH, json={**BODY, "recipient": SENDER}).status_code == 403
    wallet[0] = BUYER
    assert client.post(PATH, json=BODY).status_code == 403
    wallet[0] = None
    assert client.post(PATH, json=BODY).status_code == 401
