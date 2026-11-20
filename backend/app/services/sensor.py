import json

from Crypto.Signature import eddsa


def canonical_bytes(payload):
    return json.dumps(payload, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def sign_reading(seed, sensor_id, token_id, temperature, recorded_at, sequence):
    payload = {"schemaVersion": 1, "sensorId": sensor_id, "tokenId": token_id,
               "temperatureC": float(temperature), "recordedAt": recorded_at, "sequence": sequence}
    signer = eddsa.new(eddsa.import_private_key(seed), "rfc8032")
    return {**payload, "signature": signer.sign(canonical_bytes(payload)).hex()}
