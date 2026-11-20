
import sqlite3
from contextlib import closing

import pytest

from app.core.database import init_database


EXPECTED_TABLES = {
    "organizations",
    "wallet_profiles",
    "auth_nonces",
    "auth_sessions",
    "metadata_requests",
    "indexed_blocks",
    "chain_events",
    "documents",
    "document_uploads",
    "price_key_access",
    "oracle_readings",
    "audit_logs",
}



def test_init_database(tmp_path):
    db_path = tmp_path / "test.db"

    init_database(db_path)
    init_database(db_path)

    with closing(sqlite3.connect(db_path)) as connection:
        rows = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%'
            """
        ).fetchall()

    actual_tables = {row[0] for row in rows}

    assert len(EXPECTED_TABLES) == 12
    assert actual_tables == EXPECTED_TABLES


def test_chain_event_unique(tmp_path):
    db_path = tmp_path / "test.db"
    init_database(db_path)

    sql = """
        INSERT INTO chain_events (
            chain_id, contract_address, tx_hash,
            log_index, block_number, block_hash,
            event_name, confirmation_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """

    event = (
        11155111,
        "0xContract",
        "0xTransaction",
        0,
        12153539,
        "0xBlock",
        "MedicineRegistered",
        "CONFIRMED"
    )

    with closing(sqlite3.connect(db_path)) as connection:
        connection.execute(sql, event)

        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(sql, event)


def test_migrations_preserve_historical_rows(tmp_path):
    path = tmp_path / "historical.db"
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("CREATE TABLE oracle_readings(id INTEGER PRIMARY KEY, token_id TEXT, sensor_id TEXT, "
                   "temperature_c REAL, recorded_at TEXT, received_at TEXT, signature TEXT, validation_status TEXT)")
        db.execute("INSERT INTO oracle_readings(id,token_id) VALUES(1,'old')")
        db.execute("CREATE TABLE auth_nonces(nonce_hash TEXT PRIMARY KEY, wallet_address TEXT, domain TEXT, "
                   "chain_id INTEGER, expires_at TEXT, used_at TEXT)")
        db.execute("INSERT INTO auth_nonces(nonce_hash,wallet_address) VALUES('issued','wallet')")
    init_database(path)
    init_database(path)
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("SELECT token_id,sequence FROM oracle_readings").fetchone() == ("old", None)
        assert db.execute("SELECT nonce_hash,wallet_address,requester_hash FROM auth_nonces").fetchone() == (
            "issued", "wallet", None)
