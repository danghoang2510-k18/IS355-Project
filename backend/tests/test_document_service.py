
import json

import pytest

from app.services.document_service import (
    MAX_DOCUMENT_SIZE,
    validate_document
)


@pytest.mark.parametrize(
    "document_type,content,mime",
    [
        ("CERTIFICATE_OF_ORIGIN", b"%PDF-1.4\n%%EOF", "application/pdf"),
        ("QUALITY_CERTIFICATE", b"\xff\xd8\xff\xe0test", "image/jpeg"),
        ("QUALITY_CERTIFICATE", b"\x89PNG\r\n\x1a\ntest", "image/png")
    ]
)
def test_document_formats(document_type, content, mime):
    assert validate_document(document_type, content, mime) == mime


def test_chemical_metadata():
    metadata = {
        "schemaVersion": "1.0",
        "gtin": "09506000134352",
        "batchNumber": "LOT-2026-0001",
        "medicineName": "Demo Medicine A",
        "dosageForm": "tablet",
        "ingredients": [
            {
                "name": "Example Compound",
                "amount": "250",
                "unit": "mg"
            }
        ],
        "storage": {
            "minCelsius": 2,
            "maxCelsius": 8
        },
        "issuedBy": "Demo Manufacturer",
        "disclaimer": "Fictional test data"
    }

    content = json.dumps(metadata).encode("utf-8")

    assert validate_document(
        "CHEMICAL_METADATA",
        content,
        "application/json"
    ) == "application/json"


def test_rejects_invalid_signature():
    with pytest.raises(ValueError, match="PDF signature"):
        validate_document(
            "CERTIFICATE_OF_ORIGIN",
            b"Not a PDF",
            "application/pdf"
        )


def test_rejects_invalid_chemical_schema():
    with pytest.raises(ValueError):
        validate_document(
            "CHEMICAL_METADATA",
            b'{"schemaVersion":"1.0"}',
            "application/json"
        )


def test_rejects_mime_mismatch():
    with pytest.raises(ValueError, match="Content type"):
        validate_document(
            "QUALITY_CERTIFICATE",
            b"\xff\xd8\xff\xe0test",
            "image/png"
        )


def test_rejects_oversized_file():
    with pytest.raises(ValueError, match="size"):
        validate_document(
            "CERTIFICATE_OF_ORIGIN",
            b"x" * (MAX_DOCUMENT_SIZE + 1),
            "application/pdf"
        )
