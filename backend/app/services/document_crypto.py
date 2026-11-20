import base64
import binascii
import json
import secrets

from Crypto.Cipher import AES

from app.core.config import settings


PREFIX = b"DSCT-DOC-1"
OVERHEAD = len(PREFIX) + 12 + 16


def document_cipher(token, kind, issuer, nonce):
    try:
        key = base64.b64decode(settings.document_key_v1.get_secret_value(), validate=True)
    except (ValueError, binascii.Error):
        key = b""
    if len(key) != 32:
        raise RuntimeError("Document key unavailable")
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    context = [settings.sepolia_chain_id, settings.contract_address.lower(),
               str(token), kind, issuer.lower()]
    cipher.update(PREFIX + json.dumps(context, separators=(",", ":")).encode())
    return cipher


def encrypt_document(content, token, kind, issuer):
    nonce = secrets.token_bytes(12)
    cipher = document_cipher(token, kind, issuer, nonce)
    ciphertext, tag = cipher.encrypt_and_digest(content)
    return PREFIX + nonce + tag + ciphertext


def decrypt_document(content, token, kind, issuer):
    if not content.startswith(PREFIX) or len(content) <= OVERHEAD:
        raise ValueError("Invalid document envelope")
    offset = len(PREFIX)
    cipher = document_cipher(token, kind, issuer, content[offset:offset + 12])
    return cipher.decrypt_and_verify(content[OVERHEAD:], content[offset + 12:OVERHEAD])
