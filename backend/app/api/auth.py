
import hashlib
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StrictInt
from web3 import Web3

from app.core.config import settings
from app.core.database import get_database_path

import re
from contextlib import closing

from eth_account import Account
from eth_account.messages import encode_defunct


router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


class NonceRequest(BaseModel):
    address: str
    chain_id: StrictInt = Field(alias="chainId")


def api_error(status_code: int, code: str, message: str):
    headers = {"Retry-After": "60"} if status_code == 429 else None

    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "error": {
                "code": code,
                "message": message,
                "requestId": f"req_{secrets.token_hex(8)}"
            }
        }
    )


@router.post("/nonce")
def create_nonce(body: NonceRequest, request: Request):
    if body.chain_id != settings.sepolia_chain_id:
        return api_error(400, "VALIDATION_ERROR", "Only Sepolia is supported")

    if not Web3.is_address(body.address):
        return api_error(400, "VALIDATION_ERROR", "Invalid wallet address")

    expected_origin = settings.frontend_origin.rstrip("/")
    request_origin = request.headers.get("origin")

    if request_origin and request_origin.rstrip("/") != expected_origin:
        return api_error(403, "INVALID_ORIGIN", "Origin is not allowed")

    wallet = Web3.to_checksum_address(body.address)
    domain = urlparse(expected_origin).netloc

    now = datetime.now(timezone.utc).replace(microsecond=0)
    expires = now + timedelta(minutes=5)

    issued_at = now.isoformat().replace("+00:00", "Z")
    expires_at = expires.isoformat().replace("+00:00", "Z")

    nonce = secrets.token_hex(16)
    nonce_hash = hashlib.sha256(nonce.encode("utf-8")).hexdigest()

    message = (
        "DSCT Wallet Authentication\n"
        f"Domain: {domain}\n"
        f"Address: {wallet}\n"
        f"Chain ID: {body.chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at}\n"
        f"Expires At: {expires_at}"
    )

    peer = request.client.host if request.client else "unknown"
    requester_hash = hashlib.sha256(peer.encode()).hexdigest()
    with sqlite3.connect(get_database_path()) as connection:
        connection.execute("BEGIN IMMEDIATE")

        active_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM auth_nonces
            WHERE requester_hash = ? AND wallet_address = ?
              AND domain = ?
              AND chain_id = ?
              AND expires_at > ?
              AND used_at IS NULL
            """,
            (requester_hash, wallet, domain, body.chain_id, issued_at)
        ).fetchone()[0]

        if active_count >= 5:
            return api_error(
                429,
                "RATE_LIMITED",
                "Too many active login challenges"
            )

        connection.execute(
            """
            INSERT INTO auth_nonces (
                nonce_hash, wallet_address, domain,
                chain_id, expires_at, used_at, requester_hash
            )
            VALUES (?, ?, ?, ?, ?, NULL, ?)
            """,
            (nonce_hash, wallet, domain, body.chain_id, expires_at, requester_hash)
        )

    return {
        "data": {
            "nonce": nonce,
            "message": message,
            "expiresAt": expires_at
        },
        "meta": {
            "requestId": f"req_{secrets.token_hex(8)}"
        }
    }

SESSION_COOKIE = "dsct_session"
SESSION_TTL_SECONDS = 3600


class VerifyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    signature: str = Field(min_length=2, max_length=256)


def parse_challenge(message: str):
    if "\r" in message:
        raise ValueError("Invalid challenge format")

    lines = message.split("\n")
    prefixes = (
        "Domain: ",
        "Address: ",
        "Chain ID: ",
        "Nonce: ",
        "Issued At: ",
        "Expires At: "
    )

    if len(lines) != 7 or lines[0] != "DSCT Wallet Authentication":
        raise ValueError("Invalid challenge format")

    if any(
        not line.startswith(prefix)
        for line, prefix in zip(lines[1:], prefixes)
    ):
        raise ValueError("Invalid challenge format")

    domain, wallet, chain_text, nonce, issued_text, expiry_text = (
        line[len(prefix):]
        for line, prefix in zip(lines[1:], prefixes)
    )

    if not Web3.is_address(wallet):
        raise ValueError("Invalid wallet")

    wallet = Web3.to_checksum_address(wallet)

    if not chain_text.isascii() or not chain_text.isdecimal():
        raise ValueError("Invalid chain")

    chain_id = int(chain_text)

    if re.fullmatch(r"[0-9a-f]{32}", nonce) is None:
        raise ValueError("Invalid nonce")

    try:
        issued_at = datetime.strptime(
            issued_text, "%Y-%m-%dT%H:%M:%SZ"
        ).replace(tzinfo=timezone.utc)

        expires_at = datetime.strptime(
            expiry_text, "%Y-%m-%dT%H:%M:%SZ"
        ).replace(tzinfo=timezone.utc)
    except ValueError as error:
        raise ValueError("Invalid timestamps") from error

    canonical_message = (
        "DSCT Wallet Authentication\n"
        f"Domain: {domain}\n"
        f"Address: {wallet}\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at.strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
        f"Expires At: {expires_at.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )

    if (
        message != canonical_message
        or expires_at - issued_at != timedelta(minutes=5)
    ):
        raise ValueError("Invalid challenge format")

    return domain, wallet, chain_id, nonce, issued_at, expires_at


def allowed_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    expected = settings.frontend_origin.rstrip("/")

    return not origin or origin.rstrip("/") == expected


@router.post("/verify")
def verify_wallet(body: VerifyRequest, request: Request):
    if not allowed_origin(request):
        return api_error(403, "INVALID_ORIGIN", "Origin is not allowed")

    try:
        domain, wallet, chain_id, nonce, issued_at, expires_at = (
            parse_challenge(body.message)
        )
    except ValueError:
        return api_error(
            401, "INVALID_CHALLENGE", "Invalid login challenge"
        )

    now = datetime.now(timezone.utc).replace(microsecond=0)

    if (
        domain != urlparse(settings.frontend_origin.rstrip("/")).netloc
        or chain_id != settings.sepolia_chain_id
        or issued_at > now
        or expires_at <= now
    ):
        return api_error(
            401, "INVALID_CHALLENGE", "Invalid or expired challenge"
        )

    try:
        recovered = Account.recover_message(
            encode_defunct(text=body.message),
            signature=body.signature
        )
    except Exception:
        return api_error(
            401, "INVALID_SIGNATURE", "Invalid wallet signature"
        )

    if recovered != wallet:
        return api_error(
            401, "INVALID_SIGNATURE", "Signature does not match wallet"
        )

    nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()

    session_token = secrets.token_urlsafe(32)
    session_hash = hashlib.sha256(session_token.encode()).hexdigest()

    now_text = now.isoformat().replace("+00:00", "Z")
    nonce_expiry = expires_at.isoformat().replace("+00:00", "Z")

    session_expiry = (
        now + timedelta(seconds=SESSION_TTL_SECONDS)
    ).isoformat().replace("+00:00", "Z")

    with closing(sqlite3.connect(get_database_path())) as connection:
        with connection:
            cursor = connection.execute(
                """
                UPDATE auth_nonces
                SET used_at = ?
                WHERE nonce_hash = ?
                  AND wallet_address = ?
                  AND domain = ?
                  AND chain_id = ?
                  AND expires_at = ?
                  AND used_at IS NULL
                  AND expires_at > ?
                """,
                (
                    now_text, nonce_hash, wallet,
                    domain, chain_id, nonce_expiry, now_text
                )
            )

            if cursor.rowcount != 1:
                return api_error(
                    401, "NONCE_INVALID", "Nonce expired or already used"
                )

            connection.execute(
                """
                INSERT INTO auth_sessions (
                    session_hash, wallet_address, chain_id, expires_at
                )
                VALUES (?, ?, ?, ?)
                """,
                (session_hash, wallet, chain_id, session_expiry)
            )

    response = JSONResponse(
        content={
            "data": {
                "address": wallet,
                "chainId": chain_id,
                "expiresAt": session_expiry
            },
            "meta": {
                "requestId": f"req_{secrets.token_hex(8)}"
            }
        }
    )

    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/api/v1"
    )

    return response


def get_session_wallet(request: Request) -> str | None:
    session_token = request.cookies.get(SESSION_COOKIE)

    if not session_token:
        return None

    session_hash = hashlib.sha256(session_token.encode()).hexdigest()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    now_text = now.isoformat().replace("+00:00", "Z")

    with closing(sqlite3.connect(get_database_path())) as connection:
        row = connection.execute(
            """
            SELECT wallet_address
            FROM auth_sessions
            WHERE session_hash = ?
              AND chain_id = ?
              AND expires_at > ?
              AND revoked_at IS NULL
            """,
            (session_hash, settings.sepolia_chain_id, now_text)
        ).fetchone()

    return row[0] if row else None


@router.post("/logout")
def logout_wallet(request: Request):
    if not allowed_origin(request):
        return api_error(403, "INVALID_ORIGIN", "Origin is not allowed")

    session_token = request.cookies.get(SESSION_COOKIE)

    if session_token:
        session_hash = hashlib.sha256(session_token.encode()).hexdigest()

        now = datetime.now(timezone.utc).replace(microsecond=0)
        now_text = now.isoformat().replace("+00:00", "Z")

        with closing(sqlite3.connect(get_database_path())) as connection:
            with connection:
                connection.execute(
                    """
                    UPDATE auth_sessions
                    SET revoked_at = ?
                    WHERE session_hash = ?
                      AND revoked_at IS NULL
                    """,
                    (now_text, session_hash)
                )

    response = JSONResponse(
        content={
            "data": {"loggedOut": True},
            "meta": {
                "requestId": f"req_{secrets.token_hex(8)}"
            }
        }
    )

    response.delete_cookie(
        SESSION_COOKIE,
        path="/api/v1"
    )

    return response

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
