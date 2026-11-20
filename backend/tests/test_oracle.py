import secrets
import time
from concurrent.futures import ThreadPoolExecutor

from Crypto.Signature import eddsa
from fastapi.testclient import TestClient

from app.api import oracle
from app.core.config import SensorRegistration, settings
from app.core.database import init_database
from app.main import app
from app.services.sensor import sign_reading


def test_sensor_demo_and_concurrent_replay(tmp_path, monkeypatch):
    path = init_database(tmp_path / "oracle.db")
    monkeypatch.setattr(oracle, "get_database_path", lambda: path)
    seed = secrets.token_bytes(32)
    public = eddsa.import_private_key(seed).public_key().export_key(format="raw").hex()
    monkeypatch.setattr(settings, "oracle_sensors", {"demo": SensorRegistration(public_key=public, token_ids=["1"])})
    client = TestClient(app)
    def post(payload):
        return client.post("/api/v1/oracle/readings", json=payload)
    now = int(time.time())
    normal = sign_reading(seed, "demo", "1", 5.2, now, 1)
    alert = sign_reading(seed, "demo", "1", 9.0, now, 2)
    assert post({**normal, "temperatureC": 6}).status_code == 403
    assert post({**normal, "tokenId": "2"}).status_code == 403
    assert post(sign_reading(seed, "demo", "1", 6, now - 500, 3)).status_code == 400
    with ThreadPoolExecutor(2) as pool:
        assert sorted(r.status_code for r in pool.map(post, [normal, normal])) == [201, 409]
    assert post(alert).json()["data"]["status"] == "ALERT"
    assert post(normal).status_code == 409
    report = client.get("/api/v1/oracle/batches/1").json()
    assert report["meta"]["lastRejection"]["reason"] == "READING_REPLAY"
    history = report["data"]
    assert [item["status"] for item in history] == ["ALERT", "NORMAL"]
    assert history[0]["source"] == "simulator"
