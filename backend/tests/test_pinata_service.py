
import hashlib
import json
from unittest.mock import Mock

import pytest

from app.services import pinata_service


def test_upload_nft_metadata(monkeypatch):
    monkeypatch.setattr(
        pinata_service.settings,
        "pinata_jwt",
        "test-jwt"
    )

    response = Mock(status_code=201)
    response.json.return_value = {
        "data": {
            "cid": "bafy-test-cid",
            "created_at": "2026-11-21T00:00:00Z"
        }
    }

    post_mock = Mock(return_value=response)
    monkeypatch.setattr(pinata_service.requests, "post", post_mock)

    metadata = {"name": "Amoxicillin 500mg"}

    result = pinata_service.upload_nft_metadata(
        metadata,
        "medicine-metadata.json"
    )

    assert result["metadataCID"] == "bafy-test-cid"
    assert result["uri"] == "ipfs://bafy-test-cid"
    assert result["contentType"] == "application/json"
    assert result["pinnedAt"] == "2026-11-21T00:00:00Z"

    args, kwargs = post_mock.call_args
    content = kwargs["files"]["file"][1]

    assert args[0] == pinata_service.PINATA_UPLOAD_URL
    assert kwargs["data"]["network"] == "public"
    assert kwargs["headers"]["Authorization"] == "Bearer test-jwt"
    assert json.loads(content) == metadata
    assert result["sizeBytes"] == len(content)
    assert result["sha256"] == hashlib.sha256(content).hexdigest()


def test_upload_rejects_missing_jwt(monkeypatch):
    monkeypatch.setattr(
        pinata_service.settings,
        "pinata_jwt",
        ""
    )

    with pytest.raises(RuntimeError, match="PINATA_JWT"):
        pinata_service.upload_nft_metadata(
            {"name": "Test"},
            "test.json"
        )


def test_upload_rejects_missing_cid(monkeypatch):
    monkeypatch.setattr(
        pinata_service.settings,
        "pinata_jwt",
        "test-jwt"
    )

    response = Mock(status_code=201)
    response.json.return_value = {"data": {}}

    monkeypatch.setattr(
        pinata_service.requests,
        "post",
        Mock(return_value=response)
    )

    with pytest.raises(RuntimeError, match="CID"):
        pinata_service.upload_nft_metadata(
            {"name": "Test"},
            "test.json"
        )


def test_recover_pin_validates_account_entry_and_bytes(monkeypatch):
    meta = {"name": "fixture"}
    data = pinata_service.metadata_bytes(meta)
    monkeypatch.setattr(pinata_service.settings, "pinata_jwt", "fixture")
    response = Mock(status_code=201)
    entry = {"name": "request.json", "cid": "fixturecid", "created_at": "2026-11-21T00:00:00Z"}
    response.json.return_value = {"data": {"files": [{"name":"unrelated"}, entry]}}
    lookup = Mock(return_value=response)
    monkeypatch.setattr(pinata_service.requests, "get", lookup)
    monkeypatch.setattr(pinata_service, "download_public_document", lambda *_, **kw: data)
    recovered = pinata_service.recover_nft_metadata(meta, "request.json")
    assert recovered["sha256"] == hashlib.sha256(data).hexdigest()
    assert lookup.call_args.kwargs["params"] == {"name": "request.json"}
    monkeypatch.setattr(pinata_service, "download_public_document", lambda *_, **kw: b"other")
    assert pinata_service.recover_nft_metadata(meta, "request.json") is None


@pytest.mark.parametrize("status,error", [(307, RuntimeError), (403, pinata_service.UploadNotStarted)])
def test_pin_does_not_follow_redirects_or_accept_rejections(monkeypatch, status, error):
    monkeypatch.setattr(pinata_service.settings, "pinata_jwt", "fixture")
    post = Mock(return_value=Mock(status_code=status))
    monkeypatch.setattr(pinata_service.requests, "post", post)
    with pytest.raises(error):
        pinata_service.upload_public_document(b"fixture", "doc.bin", "application/octet-stream")
    assert post.call_count == 1
    assert post.call_args.kwargs["allow_redirects"] is False
