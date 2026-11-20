
import sqlite3
from pathlib import Path

from app.core.config import BACKEND_DIR, settings


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_profiles (
    address TEXT PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id),
    last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce_hash TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    domain TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    session_hash TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS metadata_requests (
    wallet_address TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    response_json TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (wallet_address, idempotency_key)
);

CREATE TABLE IF NOT EXISTS indexed_blocks (
    chain_id INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    finalized_at TEXT,
    PRIMARY KEY (chain_id, block_number)
);

CREATE TABLE IF NOT EXISTS chain_events (
    chain_id INTEGER NOT NULL,
    contract_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    block_hash TEXT NOT NULL,
    event_name TEXT NOT NULL,
    token_id TEXT,
    from_wallet TEXT,
    to_wallet TEXT,
    occurred_at TEXT,
    payload_json TEXT,
    confirmation_status TEXT NOT NULL,
    UNIQUE (chain_id, contract_address, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    token_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    cid TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    visibility TEXT NOT NULL,
    encrypted INTEGER NOT NULL CHECK(encrypted IN (0, 1)),
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    contract_tx_hash TEXT
);

CREATE TABLE IF NOT EXISTS document_uploads (
    pin_name TEXT PRIMARY KEY,
    token_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    visibility TEXT NOT NULL,
    uploaded_by TEXT NOT NULL COLLATE NOCASE,
    sha256 TEXT NOT NULL,
    stored_sha256 TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    UNIQUE (token_id, document_type, visibility, uploaded_by, sha256)
);

CREATE TABLE IF NOT EXISTS price_key_access (
    id INTEGER PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    token_id TEXT NOT NULL,
    transfer_tx_hash TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    wrapped_dek BLOB NOT NULL,
    key_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oracle_readings (
    id INTEGER PRIMARY KEY,
    token_id TEXT NOT NULL,
    sensor_id TEXT NOT NULL,
    temperature_c REAL NOT NULL,
    recorded_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    signature TEXT NOT NULL,
    validation_status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    actor_wallet TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    outcome TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    request_id TEXT
);
"""


def get_database_path() -> Path:
    prefix = "sqlite:///"

    if not settings.database_url.startswith(prefix):
        raise ValueError("Only SQLite is configured for the demo")

    path = Path(settings.database_url[len(prefix):])

    if not path.is_absolute():
        path = BACKEND_DIR / path

    return path.resolve()


def init_database(db_path: Path | None = None) -> Path:
    path = db_path if db_path is not None else get_database_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(path)

    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(SCHEMA_SQL)
        connection.execute("BEGIN IMMEDIATE")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(auth_nonces)")}
        if "requester_hash" not in columns:
            connection.execute("ALTER TABLE auth_nonces ADD COLUMN requester_hash TEXT")
        connection.execute("CREATE INDEX IF NOT EXISTS nonce_requester_limit ON auth_nonces "
                           "(requester_hash, wallet_address, domain, chain_id, expires_at)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(price_key_access)")}
        if "transfer_id" not in columns:
            connection.execute("ALTER TABLE price_key_access ADD COLUMN transfer_id TEXT")
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS price_party "
                           "ON price_key_access(transfer_id, wallet_address)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(oracle_readings)")}
        if "sequence" not in columns:
            connection.execute("ALTER TABLE oracle_readings ADD COLUMN sequence INTEGER")
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS oracle_sequence "
                           "ON oracle_readings(sensor_id, sequence)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(indexed_blocks)")}
        for name, kind in [("contract_address", "TEXT"), ("observed_head", "INTEGER"),
                           ("checked_at", "INTEGER")]:
            if name not in columns:
                connection.execute(f"ALTER TABLE indexed_blocks ADD COLUMN {name} {kind}")
        connection.execute("CREATE INDEX IF NOT EXISTS chain_batch_events ON chain_events "
                           "(chain_id,contract_address,token_id,block_number,log_index)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(metadata_requests)")}
        if "metadata_json" not in columns:
            connection.execute("ALTER TABLE metadata_requests ADD COLUMN metadata_json TEXT")
        connection.commit()
    finally:
        connection.close()

    return path
