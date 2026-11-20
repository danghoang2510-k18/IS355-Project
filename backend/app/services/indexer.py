"""Read confirmed contract events. Run explicitly with python -m app.services.indexer."""
import argparse
import json
import sqlite3
import time
from contextlib import closing

from web3 import Web3

from app.core.config import settings
from app.core.database import get_database_path, init_database
from app.services.web3_service import create_web3_client

NAMES = ("MedicineRegistered", "CustodyTransferred", "DocumentCIDUpdated", "TokenBurned", "ParticipantUpdated")


def checkpoint(db, chain, address):
    return db.execute("SELECT block_number,block_hash,observed_head,checked_at FROM indexed_blocks "
                      "WHERE chain_id=? AND contract_address=? ORDER BY block_number DESC LIMIT 1",
                      (chain, address)).fetchone()


class ContractReader:
    def __init__(self):
        self.contract = create_web3_client()
        self.eth = self.contract.w3.eth
        self.decoders = {}
        for name in NAMES:
            decoder = getattr(self.contract.events, name)()
            self.decoders[decoder.topic.lower()] = decoder

    def head(self):
        return self.eth.block_number

    def block(self, number):
        block = self.eth.get_block(number)
        return Web3.to_hex(block.hash), block.timestamp

    def events(self, start, end):
        logs = self.eth.get_logs({"address": self.contract.address, "fromBlock": start, "toBlock": end,
                                  "topics": [list(self.decoders)]})
        for log in logs:
            event = self.decoders[Web3.to_hex(log.topics[0]).lower()].process_log(log)
            args = {k: Web3.to_hex(v) if isinstance(v, bytes) else v for k, v in event.args.items()}
            yield (log.blockNumber, Web3.to_hex(log.blockHash), Web3.to_hex(log.transactionHash),
                   log.logIndex, event.event, args)


def linked_document_cids(token: int, kind: int, reference: dict):
    chain, address = settings.sepolia_chain_id, settings.contract_address.lower()
    with closing(sqlite3.connect(get_database_path())) as db:
        db.execute("BEGIN")
        cursor = checkpoint(db, chain, address)
        rows = db.execute(
            """SELECT event_name, json_extract(payload_json, '$.cid'), occurred_at
               FROM chain_events
               WHERE chain_id=? AND contract_address=? AND token_id=? AND confirmation_status='CONFIRMED'
                 AND (event_name='MedicineRegistered' OR
                     (event_name='DocumentCIDUpdated' AND json_extract(payload_json, '$.documentType')=?))
               ORDER BY block_number, log_index""",
            (chain, address, str(token), kind)
        ).fetchall()
    if not cursor or not rows or rows[0][0] != "MedicineRegistered":
        raise RuntimeError("Missing indexed history from token registration")
    block_hash, timestamp = ContractReader().block(cursor[0])
    if block_hash != cursor[1] or timestamp < reference["updated_at"]:
        raise RuntimeError("Index does not cover the latest canonical update")
    last_event, cid, occurred_at = rows[-1]
    if last_event != "DocumentCIDUpdated" or cid != reference["cid"] or int(occurred_at) != reference["updated_at"]:
        raise RuntimeError("Document reference differs from indexed history")
    return {cid for event, cid, _ in rows if event == "DocumentCIDUpdated"}


class ChainChanged(RuntimeError):
    pass


def sync_range(reader, db):
    chain, address = settings.sepolia_chain_id, settings.contract_address.lower()
    head = reader.head()
    target = head - settings.chain_confirmations + 1
    foreign = db.execute("SELECT 1 FROM indexed_blocks WHERE chain_id=? AND "
                         "COALESCE(contract_address,'') != ? LIMIT 1", (chain, address)).fetchone()
    if foreign:
        raise ValueError("Indexer database belongs to a different or unknown deployment")
    previous = checkpoint(db, chain, address)
    cursor = previous
    while cursor and (cursor[0] > target or reader.block(cursor[0])[0] != cursor[1]):
        cursor = db.execute(
            "SELECT block_number,block_hash,observed_head,checked_at FROM indexed_blocks "
            "WHERE chain_id=? AND contract_address=? AND block_number<? ORDER BY block_number DESC LIMIT 1",
            (chain, address, cursor[0])
        ).fetchone()
    start = cursor[0] + 1 if cursor else settings.deployment_block
    if previous != cursor or start > target or (cursor and cursor[2] != target):
        with db:
            db.execute("BEGIN IMMEDIATE")
            if checkpoint(db, chain, address) != previous:
                raise ChainChanged("Another indexer advanced the cursor")
            if previous != cursor:
                for table in ("indexed_blocks", "chain_events"):
                    db.execute(f"DELETE FROM {table} WHERE chain_id=? AND contract_address=? AND block_number>=?",
                               (chain, address, start))
            if cursor:
                db.execute("UPDATE indexed_blocks SET observed_head=?,checked_at=? "
                           "WHERE chain_id=? AND block_number=?", (target, int(time.time()), chain, cursor[0]))
                cursor = checkpoint(db, chain, address)
            if start > target:
                return True

    end = min(start + settings.indexer_chunk_size - 1, target)
    end_hash, timestamp = reader.block(end)
    rows = []
    blocks = {end: (end_hash, timestamp)}
    for number, block_hash, tx, index, name, args in reader.events(start, end):
        if number not in blocks:
            blocks[number] = reader.block(number)
        if not start <= number <= end or blocks[number][0] != block_hash:
            raise ChainChanged("Block changed while indexing")
        rows.append((chain, address, tx, index, number, block_hash, name,
                     str(args["tokenId"]) if "tokenId" in args else None,
                     args.get("from"), args.get("to"), str(blocks[number][1]), json.dumps(args), "CONFIRMED"))
    if reader.block(end)[0] != end_hash or (cursor and reader.block(cursor[0])[0] != cursor[1]):
        raise ChainChanged("Chain changed during log read")

    with db:
        db.execute("BEGIN IMMEDIATE")
        if checkpoint(db, chain, address) != cursor:
            raise ChainChanged("Another indexer advanced the cursor")
        db.executemany("INSERT INTO chain_events(chain_id,contract_address,tx_hash,log_index,"
                       "block_number,block_hash,event_name,token_id,from_wallet,to_wallet,occurred_at,"
                       "payload_json,confirmation_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        db.execute("INSERT INTO indexed_blocks(chain_id,block_number,block_hash,finalized_at,"
                   "contract_address,observed_head,checked_at) VALUES(?,?,?,datetime('now'),?,?,?)",
                   (chain, end, end_hash, address, target, int(time.time())))
    return end == target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--follow", action="store_true", help="Poll after reaching the confirmed head")
    args = parser.parse_args()
    init_database()
    failures = 0
    with closing(sqlite3.connect(get_database_path())) as db:
        while True:
            try:
                caught_up = sync_range(ContractReader(), db)
                failures = 0
                if caught_up:
                    if not args.follow:
                        return
                    time.sleep(12)
            except ValueError:
                raise SystemExit("Invalid indexer configuration or response")
            except Exception:
                failures += 1
                if failures >= 5:
                    raise SystemExit("Indexing interrupted; rerun to resume the last verified range")
                time.sleep(min(2 ** failures, 30))


if __name__ == "__main__":
    main()
