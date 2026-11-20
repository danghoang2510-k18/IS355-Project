import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.api import batches
from app.core.config import settings
from app.core.database import init_database
from app.main import app
from app.services.indexer import sync_range


class Reader:
    fork = 0
    height = 14
    failed = False

    def head(self):
        return self.height

    def block(self, n):
        return f"block-{n}-{self.fork if n >= 12 else 0}", 1234 + n

    def events(self, start, end):
        if self.failed:
            raise TimeoutError()
        for n in range(start, end + 1):
            key = f"{n}-{self.fork if n >= 12 else 0}"
            yield n, self.block(n)[0], key, 0, "MedicineRegistered", {"tokenId": n}


def test_index_resume_confirmations_reorg_pagination(tmp_path, monkeypatch):
    path = init_database(tmp_path / "index.db")
    for field, value in {"deployment_block": 10, "indexer_chunk_size": 2, "chain_confirmations": 2,
                         "contract_address": "0xcontract"}.items():
        monkeypatch.setattr(settings, field, value)
    monkeypatch.setattr(batches, "get_database_path", lambda: path)
    client = TestClient(app)
    reader = Reader()
    with closing(sqlite3.connect(path)) as db:
        assert not sync_range(reader, db)
        assert client.get("/api/v1/batches").status_code == 503
        reader.failed = True
        with pytest.raises(TimeoutError):
            sync_range(reader, db)
        assert db.execute("SELECT MAX(block_number) FROM indexed_blocks").fetchone() == (11,)
        reader.failed = False
        assert sync_range(reader, db)
        assert sync_range(reader, db)
        assert client.get("/api/v1/batches?limit=2").json()["meta"]["hasMore"]
        assert [r["tokenId"] for r in client.get("/api/v1/batches?page=2&limit=2").json()["data"]] == ["12", "13"]
        reader.fork += 1
        assert sync_range(reader, db)
        items = client.get("/api/v1/batches/12/timeline").json()["data"]
        assert [r["txHash"] for r in items] == ["12-1"]
        assert db.execute("SELECT COUNT(*) FROM chain_events").fetchone() == (4,)
        reader.height += 1
        reader.failed = True
        with pytest.raises(TimeoutError):
            sync_range(reader, db)
        assert client.get("/api/v1/batches").status_code == 503
        reader.failed = False
        assert sync_range(reader, db)
        assert client.get("/api/v1/batches").status_code == 200
        db.execute("UPDATE indexed_blocks SET checked_at=0")
        db.commit()
        assert client.get("/api/v1/batches").status_code == 503


def test_registry_owner_filters_before_pagination_at_confirmed_snapshot(tmp_path, monkeypatch):
    maker, buyer = "0x" + "a" * 40, "0x" + "b" * 40
    data = [
        ("MedicineRegistered", {"tokenId": 1, "manufacturer": maker}),
        ("MedicineRegistered", {"tokenId": 2, "manufacturer": buyer}),
        ("MedicineRegistered", {"tokenId": 3, "manufacturer": maker}),
        ("MedicineRegistered", {"tokenId": 4, "manufacturer": maker}),
        ("CustodyTransferred", {"tokenId": 1, "from": maker, "to": buyer}),
        ("TokenBurned", {"tokenId": 2, "lastOwner": buyer}),
        ("MedicineRegistered", {"tokenId": 5, "manufacturer": buyer}),
    ]

    class OwnershipReader(Reader):
        height = 10

        def events(self, start, end):
            for n in range(start, end + 1):
                name, args = data[n - 10]
                yield n, self.block(n)[0], f"tx-{n}", 0, name, args

    path = init_database(tmp_path / "registry.db")
    monkeypatch.setattr(settings, "deployment_block", 10)
    monkeypatch.setattr(settings, "chain_confirmations", 1)
    monkeypatch.setattr(batches, "get_database_path", lambda: path)
    client = TestClient(app)
    reader = OwnershipReader()
    def page(wallet, number=1):
        return client.get("/api/v1/batches", params={"owner": wallet, "page": number, "limit": 1})

    assert page("bad").status_code == 400
    assert page(maker).status_code == 503
    with closing(sqlite3.connect(path)) as db:
        assert sync_range(reader, db)
        assert page(maker).json()["data"][0]["tokenId"] == "1"
        reader.height = 16
        while not sync_range(reader, db):
            pass
    for wallet, expected in [(maker, ["3", "4"]), (buyer, ["1", "5"])]:
        first, second = [page(wallet, n).json() for n in (1, 2)]
        assert [first["data"][0]["tokenId"], second["data"][0]["tokenId"]] == expected
        assert first["meta"]["hasMore"] and not second["meta"]["hasMore"]
        assert first["meta"]["blockHash"] == second["meta"]["blockHash"] == reader.block(16)[0]
        assert page(wallet, 3).json()["data"] == []
    assert page("0x" + "c" * 40).json()["data"] == []
    assert len(client.get("/api/v1/batches").json()["data"]) == 5


def test_block_reads_do_not_hold_database_writer(tmp_path, monkeypatch):
    path = init_database(tmp_path / "concurrent.db")
    monkeypatch.setattr(settings, "deployment_block", 10)
    monkeypatch.setattr(settings, "chain_confirmations", 1)
    monkeypatch.setattr(settings, "contract_address", "fixture")
    reader = Reader()
    with closing(sqlite3.connect(path)) as db:
        assert sync_range(reader, db)
        original_block = reader.block
        def read_with_other_writer(number):
            with closing(sqlite3.connect(path, timeout=0)) as writer, writer:
                writer.execute("BEGIN IMMEDIATE")
            return original_block(number)
        monkeypatch.setattr(reader, "block", read_with_other_writer)
        assert sync_range(reader, db)
