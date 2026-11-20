import sqlite3
import time
from contextlib import closing

from Crypto.Signature import eddsa
from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.auth import api_error
from app.api.documents import parse_document_token_id
from app.core.config import settings
from app.core.database import get_database_path
from app.services.sensor import canonical_bytes

router = APIRouter(prefix="/api/v1/oracle", tags=["Oracle"])


class Reading(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    schemaVersion: int = Field(ge=1, le=1)
    sensorId: str = Field(min_length=1, max_length=80)
    tokenId: str = Field(pattern=r"^[1-9][0-9]{0,77}$")
    temperatureC: float
    recordedAt: int = Field(ge=0)
    sequence: int = Field(ge=0, lt=2**63)
    signature: str = Field(pattern=r"^[0-9a-fA-F]{128}$")


def record_rejection(db, token, reason):
    db.execute("INSERT INTO audit_logs(action,resource,outcome,timestamp) "
               "VALUES('ORACLE_REJECT',?,?,datetime('now'))", (token, reason))


@router.post("/readings", status_code=201)
def receive_reading(body: Reading):
    sensor = settings.oracle_sensors.get(body.sensorId)
    if not sensor or body.tokenId not in sensor.token_ids or int(body.tokenId) >= 2**256:
        return api_error(403, "SENSOR_FORBIDDEN", "Sensor is not assigned to this batch")
    now = int(time.time())
    try:
        key = eddsa.import_public_key(bytes.fromhex(sensor.public_key))
        eddsa.new(key, "rfc8032").verify(canonical_bytes(body.model_dump(exclude={"signature"})),
                                         bytes.fromhex(body.signature))
    except ValueError:
        return api_error(403, "SIGNATURE_INVALID", "Invalid sensor signature")
    status = "NORMAL" if 2 <= body.temperatureC <= 8 else "ALERT"
    try:
        with closing(sqlite3.connect(get_database_path())) as db, db:
            db.execute("BEGIN IMMEDIATE")
            if abs(now - body.recordedAt) > 300:
                record_rejection(db, body.tokenId, "STALE_READING")
                return api_error(400, "STALE_READING", "Timestamp is outside the five-minute window")
            highest, = db.execute("SELECT MAX(sequence) FROM oracle_readings WHERE sensor_id=?",
                                  (body.sensorId,)).fetchone()
            if highest is not None and body.sequence <= highest:
                record_rejection(db, body.tokenId, "READING_REPLAY")
                return api_error(409, "READING_REPLAY", "Sequence must increase")
            db.execute("INSERT INTO oracle_readings(token_id,sensor_id,temperature_c,recorded_at,"
                       "received_at,signature,validation_status,sequence) VALUES(?,?,?,?,?,?,?,?)",
                       (body.tokenId, body.sensorId, body.temperatureC, body.recordedAt, now,
                        body.signature, status, body.sequence))
    except sqlite3.Error:
        return api_error(503, "STORAGE_UNAVAILABLE", "Cannot store reading")
    return {"data": {"status": status, "sequence": body.sequence}}


@router.get("/batches/{token_id}")
def batch_readings(token_id: str, limit: int = Query(20, ge=1, le=100)):
    try:
        token = parse_document_token_id(token_id)
    except ValueError:
        return api_error(400, "VALIDATION_ERROR", "Invalid token ID")
    try:
        with closing(sqlite3.connect(get_database_path())) as db:
            rejected = db.execute("SELECT outcome,timestamp FROM audit_logs WHERE action='ORACLE_REJECT' "
                                  "AND resource=? ORDER BY id DESC LIMIT 1", (str(token),)).fetchone()
            rows = db.execute("SELECT sensor_id,sequence,temperature_c,recorded_at,validation_status "
                              "FROM oracle_readings WHERE token_id=? AND sequence IS NOT NULL "
                              "ORDER BY id DESC LIMIT ?", (str(token), limit)).fetchall()
    except sqlite3.Error:
        return api_error(503, "STORAGE_UNAVAILABLE", "Cannot read sensor history")
    readings = []
    for sensor_id, seq, temp, recorded, status in rows:
        sensor = settings.oracle_sensors.get(sensor_id)
        readings.append({"sensorId": sensor_id, "sequence": seq, "temperatureC": temp,
                         "recordedAt": int(recorded), "status": status,
                         "source": sensor.source if sensor else None,
                         "calibration": sensor.calibration if sensor else None})
    return {"data": readings, "meta": {"lastRejection": ({"reason": rejected[0], "at": rejected[1]}
                                                      if rejected else None)}}
