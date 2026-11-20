
import json
import math
import re


MAX_DOCUMENT_SIZE = 10 * 1024 * 1024

DOCUMENT_TYPES = {
    "CERTIFICATE_OF_ORIGIN": {"application/pdf"},
    "QUALITY_CERTIFICATE": {"image/jpeg", "image/png"},
    "CHEMICAL_METADATA": {"application/json"}
}


def validate_chemical_metadata(content: bytes):
    try:
        data = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid JSON document") from error

    if not isinstance(data, dict):
        raise ValueError("Chemical metadata must be an object")

    if data.get("schemaVersion") != "1.0":
        raise ValueError("Invalid schema version")

    required_strings = (
        "batchNumber",
        "medicineName",
        "dosageForm",
        "issuedBy"
    )

    for field in required_strings:
        value = data.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Invalid field: {field}")

    gtin = data.get("gtin")

    if not isinstance(gtin, str) or not re.fullmatch(r"[0-9]{14}", gtin):
        raise ValueError("Invalid GTIN")

    ingredients = data.get("ingredients")

    if not isinstance(ingredients, list) or not ingredients:
        raise ValueError("Invalid ingredients")

    for ingredient in ingredients:
        if not isinstance(ingredient, dict):
            raise ValueError("Invalid ingredient")

        for field in ("name", "amount", "unit"):
            value = ingredient.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Invalid ingredient field: {field}")

    storage = data.get("storage")

    if not isinstance(storage, dict):
        raise ValueError("Invalid storage")

    minimum = storage.get("minCelsius")
    maximum = storage.get("maxCelsius")

    for value in (minimum, maximum):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise ValueError("Invalid storage temperature")

    if minimum > maximum:
        raise ValueError("Invalid storage range")

    disclaimer = data.get("disclaimer")

    if disclaimer is not None and not isinstance(disclaimer, str):
        raise ValueError("Invalid disclaimer")

    return data


def validate_document(
    document_type: str,
    content: bytes,
    declared_content_type: str | None = None,
    *, batch: dict | None = None
) -> str:
    if document_type not in DOCUMENT_TYPES:
        raise ValueError("Unsupported document type")

    if not isinstance(content, bytes) or not 0 < len(content) <= MAX_DOCUMENT_SIZE:
        raise ValueError("Invalid document size")

    if document_type == "CERTIFICATE_OF_ORIGIN":
        if not content.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF signature")
        detected_type = "application/pdf"

    elif document_type == "QUALITY_CERTIFICATE":
        if content.startswith(b"\xff\xd8\xff"):
            detected_type = "image/jpeg"
        elif content.startswith(b"\x89PNG\r\n\x1a\n"):
            detected_type = "image/png"
        else:
            raise ValueError("Invalid image signature")

    else:
        metadata = validate_chemical_metadata(content)
        if batch is not None and (metadata["gtin"] != batch["gtin"]
                                  or metadata["batchNumber"] != batch["batch_number"]):
            raise ValueError("Chemical metadata GTIN or batch number does not match this NFT")
        detected_type = "application/json"

    if declared_content_type:
        declared_type = declared_content_type.split(";")[0].strip().lower()

        if declared_type != detected_type:
            raise ValueError("Content type does not match file content")

    return detected_type
