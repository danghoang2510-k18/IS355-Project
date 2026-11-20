"""FastAPI + the existing in-memory Hardhat fixture. Pinata transport is simulated."""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import subprocess
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from unittest.mock import Mock

from fastapi.testclient import TestClient
from pydantic import SecretStr
from web3 import Web3
from web3.providers.base import BaseProvider

from app.api import prices
from app.core.config import settings
from app.core.database import init_database
from app.main import app
from app.services import indexer, pinata_service, web3_service

ROOT = Path(__file__).resolve().parents[2]
BRIDGE = """
import {ethers, deployFixture} from './test/fixture.ts';
import {createInterface} from 'node:readline';
if ((await ethers.provider.getNetwork()).chainId !== 31337n) throw Error('Simulated Hardhat chain required');
const fixture = await deployFixture();
console.log(JSON.stringify(await fixture.supply.getAddress()));
for await (const line of createInterface({input: process.stdin})) {
  const {method, params} = JSON.parse(line);
  try { console.log(JSON.stringify({result:await ethers.provider.send(method, params)})); }
  catch (e) { console.log(JSON.stringify({error:{code:-32000,message:String(e.message)}})); }
}
"""


class FixtureProvider(BaseProvider):
    def __init__(self, process):
        super().__init__()
        self.process = process

    def make_request(self, method, params):
        self.process.stdin.write(json.dumps({"method": method, "params": params}) + "\n")
        self.process.stdin.flush()
        return {"jsonrpc": "2.0", "id": 1, **json.loads(self.process.stdout.readline())}


def test_batch_lifecycle_with_local_evm(tmp_path, monkeypatch):
    contracts = Path(os.environ.get("PHARMA_TEST_CONTRACTS", ROOT / "contracts"))
    with subprocess.Popen(["node", "--experimental-strip-types", "--input-type=module", "-e", BRIDGE],
                          cwd=contracts, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
        try:
            address = json.loads(process.stdout.readline())
            w3 = Web3(FixtureProvider(process))
            assert w3.eth.chain_id == 31337
            abi = json.loads((ROOT / "shared/abi/DrugSupplyChain.json").read_text(encoding="utf-8"))
            contract = w3.eth.contract(address=address, abi=abi)
            exercise_api(w3, contract, tmp_path, monkeypatch)
        finally:
            process.stdin.close()
            process.terminate()


def exercise_api(w3, contract, tmp_path, monkeypatch):
    db = init_database(tmp_path / "acceptance.db")
    for name, value in {"database_url": f"sqlite:///{db}", "sepolia_chain_id": 31337,
                        "contract_address": contract.address, "deployment_block": 0,
                        "chain_confirmations": 1, "pinata_jwt": "fixture"}.items():
        monkeypatch.setattr(settings, name, value)
    for key in ("price_key_v1", "document_key_v1"):
        monkeypatch.setattr(settings, key, SecretStr(base64.b64encode(secrets.token_bytes(32)).decode()))
    for module in (web3_service, prices, indexer):
        monkeypatch.setattr(module, "create_web3_client", lambda: contract)
    blobs = {}

    def pin(url, **kwargs):
        data = kwargs["files"]["file"][1]
        cid = "fixture" + hashlib.sha256(data).hexdigest()
        blobs[cid] = data
        response = Mock(status_code=201)
        response.json.return_value = {"data": {"cid": cid, "created_at": datetime.now(timezone.utc).isoformat()}}
        return response

    def fetch(url, **kwargs):
        response = Mock(status_code=200)
        response.iter_content.return_value = [blobs[url.split("/")[-1]]]
        return response

    monkeypatch.setattr(pinata_service.requests, "post", pin)
    monkeypatch.setattr(pinata_service.requests, "get", fetch)
    client = TestClient(app)
    client.headers["origin"] = settings.frontend_origin
    maker, distributor, pharmacy = w3.eth.accounts[1:4]

    def login(wallet):
        nonce = client.post("/api/v1/auth/nonce", json={"address": wallet, "chainId": 31337})
        message = nonce.json()["data"]["message"]
        signed = w3.provider.make_request("personal_sign", [Web3.to_hex(text=message), wallet])
        result = client.post("/api/v1/auth/verify", json={"message": message, "signature": signed["result"]})
        assert result.status_code == 200, result.text

    def confirm(call, sender):
        tx = call.transact({"from": sender, "gas": 3000000})
        receipt = w3.eth.get_transaction_receipt(tx)
        assert receipt.status == 1
        return Web3.to_hex(tx)

    login(maker)
    today = datetime.now(timezone.utc).date()
    meta = client.post("/api/v1/metadata/medicine-batches", headers={"Idempotency-Key": str(uuid4())},
                       json={"gtin": "09506000134352", "batchNumber": "LOT-2026-0001", "medicineName": "Sample",
                             "manufactureDate": str(today - timedelta(days=2)), "expiryDate": str(today + timedelta(days=60))})
    assert meta.status_code == 201, meta.text
    cid = meta.json()["data"]["metadataCID"]
    timestamp = w3.eth.get_block("latest").timestamp
    fn = contract.functions
    confirm(fn.registerMedicine("09506000134352", "LOT-2026-0001", "Sample", timestamp-86400,
                                timestamp+86400*60, cid), maker)
    assert fn.verifyAuthenticity(1, maker).call()
    assert fn.ownerOf(1).call() == maker
    assert fn.tokenURI(1).call() == "ipfs://" + cid
    assert client.get("/api/v1/batches/1").json()["data"]["status"] == "AUTHENTIC"
    docs = "/api/v1/batches/1/documents"
    for kind, (name, mime, restricted) in enumerate([
        ("certificate-of-origin.pdf", "application/pdf", False),
        ("coa-scan.png", "image/png", True),
        ("chemical-metadata.json", "application/json", False),
    ]):
        doc_type = list(web3_service.DOCUMENT_TYPE_IDS)[kind]
        original = (ROOT / "sample-data/documents" / name).read_bytes()
        upload = client.post(docs, files={"file": (name, original, mime)},
                             data={"documentType": doc_type, "visibility": "RESTRICTED" if restricted else "PUBLIC"})
        assert upload.status_code == 201, upload.text
        doc_cid = upload.json()["data"]["cid"]
        if restricted:
            assert blobs[doc_cid] != original
        selection = {"documentType": doc_type, "visibility": "RESTRICTED" if restricted else "PUBLIC"}
        assert client.get(docs + "/pending", params=selection).json()["data"] == {"cid": doc_cid}
        confirm(fn.setDocumentCID(1, kind, doc_cid), maker)
        assert client.get(docs + "/pending", params=selection).json()["data"] is None
        assert client.get(docs + "/" + doc_type + "/content").content == original
    for sender, recipient in [(maker, distributor), (distributor, pharmacy)]:
        login(sender)
        price = client.post("/api/v1/encryption/prices", json={"tokenId":"1", "recipient":recipient,
                                                               "amount":"17.25", "currency":"USD"})
        assert price.status_code == 200, price.text
        tx = confirm(fn.transferOwnership(1, recipient, price.json()["data"]["encryptedPrice"]), sender)
        login(recipient)
        value = client.post("/api/v1/encryption/prices/decrypt", json={"tokenId":"1", "txHash":tx})
        assert value.json()["data"]["amount"] == "17.25", value.text
        assert client.get(docs + "/QUALITY_CERTIFICATE/content").status_code == 200
    last_transfer = {"tokenId": "1", "txHash": tx}
    with monkeypatch.context() as finality:
        finality.setattr(settings, "chain_confirmations", 2)
        assert client.post("/api/v1/encryption/prices/decrypt", json=last_transfer).status_code == 409
    login(distributor)
    assert client.get(docs + "/QUALITY_CERTIFICATE/content").status_code == 403
    login(maker)
    assert client.get(docs + "/QUALITY_CERTIFICATE/content").status_code == 200
    assert client.post("/api/v1/encryption/prices/decrypt", json=last_transfer).status_code == 403
    login(pharmacy)
    confirm(fn.burnToken(1, 1), pharmacy)
    assert client.get("/api/v1/batches/1").json()["data"]["status"] == "CONSUMED"
    assert not fn.verifyAuthenticity(1, pharmacy).call()
    reader = indexer.ContractReader()
    with closing(sqlite3.connect(db)) as conn:
        while not indexer.sync_range(reader, conn):
            pass
    history = client.get("/api/v1/batches/1/timeline").json()["data"]
    assert [r["event"] for r in history] == ["MedicineRegistered"] + ["DocumentCIDUpdated"]*3 + [
        "CustodyTransferred", "CustodyTransferred", "TokenBurned"]

    login(maker)
    confirm(fn.registerMedicine("09506000134352", "HISTORY", "Sample", timestamp-86400,
                                timestamp+86400*60, cid), maker)
    check_replaced_documents(client, fn, confirm, maker, reader, db, monkeypatch)


def check_replaced_documents(client, fn, confirm, maker, reader, db, monkeypatch):
    path = "/api/v1/batches/2/documents"
    kind = "CERTIFICATE_OF_ORIGIN"

    def upload(label, visibility):
        response = client.post(path, files={"file": ("doc.pdf", b"%PDF-1.4 " + label, "application/pdf")},
                               data={"documentType": kind, "visibility": visibility})
        assert response.status_code == 201, response.text
        return response.json()["data"]["cid"]

    def pending(visibility):
        return client.get(path + "/pending", params={"documentType": kind, "visibility": visibility})

    def sync():
        with closing(sqlite3.connect(db)) as connection:
            while not indexer.sync_range(reader, connection):
                pass

    public = upload(b"version A", "PUBLIC")
    assert pending("PUBLIC").json()["data"] == {"cid": public}
    assert pending("RESTRICTED").json()["data"] is None
    confirm(fn.setDocumentCID(2, 0, public), maker)
    assert pending("PUBLIC").json()["data"] is None
    private = upload(b"version B", "RESTRICTED")
    assert pending("RESTRICTED").status_code == 503
    sync()
    assert pending("RESTRICTED").json()["data"] == {"cid": private}
    confirm(fn.setDocumentCID(2, 0, private), maker)
    assert pending("PUBLIC").status_code == 503
    sync()
    assert pending("PUBLIC").json()["data"] is None
    assert pending("RESTRICTED").json()["data"] is None
    public_c = upload(b"version C", "PUBLIC")
    restricted_c = upload(b"restricted C", "RESTRICTED")
    with monkeypatch.context() as changed_chain:
        changed_chain.setattr(indexer.ContractReader, "block", lambda *_: ("different-block", 0))
        assert pending("PUBLIC").json()["error"]["code"] == "LINK_HISTORY_UNAVAILABLE"
    assert pending("PUBLIC").json()["data"] == {"cid": public_c}
    assert pending("RESTRICTED").json()["data"] == {"cid": restricted_c}
    confirm(fn.setDocumentCID(2, 0, public_c), maker)
    sync()
    assert pending("PUBLIC").json()["data"] is None
    assert pending("RESTRICTED").json()["data"] == {"cid": restricted_c}
