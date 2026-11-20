
from unittest.mock import MagicMock

import pytest

from app.services import web3_service


MANUFACTURER = "0x0135b764190A75D879d0946EA80D9F9F82AB75ac"
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


@pytest.fixture
def contract(monkeypatch):
    fake_contract = MagicMock()

    monkeypatch.setattr(
        web3_service,
        "create_web3_client",
        lambda: fake_contract
    )

    return fake_contract


def test_get_participant(contract):
    contract.functions.getParticipant.return_value.call.return_value = (
        MANUFACTURER,
        1,
        "DSCT Manufacturer",
        True
    )

    result = web3_service.get_participant(MANUFACTURER)

    assert result["role"] == "MANUFACTURER"
    assert result["organization_name"] == "DSCT Manufacturer"
    assert result["active"] is True


def test_verify_product_not_found(contract):
    contract.functions.verifyProduct.return_value.call.return_value = (
        0,
        ZERO_ADDRESS
    )

    result = web3_service.verify_product(1)

    assert result["status"] == "NOT_FOUND"
    assert result["current_owner"] == ZERO_ADDRESS


def test_get_medicine_not_found(contract):
    contract.functions.verifyProduct.return_value.call.return_value = (
        0,
        ZERO_ADDRESS
    )

    result = web3_service.get_medicine(1)

    assert result is None
    contract.functions.getMedicine.assert_not_called()


def test_get_medicine_active(contract):
    contract.functions.verifyProduct.return_value.call.return_value = (
        1,
        MANUFACTURER
    )

    contract.functions.getMedicine.return_value.call.return_value = (
        1,
        "03459876012345",
        "BT-2026-001",
        "Amoxicillin 500mg",
        MANUFACTURER,
        1763337600,
        1857945600,
        1763337600,
        0,
        0,
        "bafy-example"
    )

    result = web3_service.get_medicine(1)

    assert result["token_id"] == "1"
    assert result["medicine_name"] == "Amoxicillin 500mg"
    assert result["lifecycle"] == "ACTIVE"
    assert result["stage"] == "AT_MANUFACTURER"
    assert result["metadata_cid"] == "bafy-example"


@pytest.mark.parametrize("status", [0, 3, 4])
def test_get_token_owner_unavailable(contract, status):
    contract.functions.verifyProduct.return_value.call.return_value = (
        status,
        ZERO_ADDRESS
    )

    result = web3_service.get_token_owner(1)

    assert result is None
    contract.functions.ownerOf.assert_not_called()


def test_get_token_owner_active(contract):
    contract.functions.verifyProduct.return_value.call.return_value = (
        1,
        MANUFACTURER
    )

    contract.functions.ownerOf.return_value.call.return_value = (
        MANUFACTURER
    )

    result = web3_service.get_token_owner(1)

    assert result == MANUFACTURER
