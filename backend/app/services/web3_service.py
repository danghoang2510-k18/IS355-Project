
import json

from web3 import Web3
from app.core.config import BACKEND_DIR, settings


ROLE_NAMES = [
    "NONE",
    "MANUFACTURER",
    "DISTRIBUTOR",
    "PHARMACY",
    "HOSPITAL"
]

VERIFICATION_STATUSES = [
    "NOT_FOUND",
    "AUTHENTIC",
    "EXPIRED",
    "CONSUMED",
    "DESTROYED",
    "INVALID_OWNER"
]

LIFECYCLE_NAMES = ["ACTIVE", "CONSUMED", "DESTROYED"]

STAGE_NAMES = [
    "AT_MANUFACTURER",
    "AT_DISTRIBUTOR",
    "AT_DISPENSER"
]
def create_web3_client():
    if not settings.sepolia_rpc_url:
        raise RuntimeError("SEPOLIA_RPC_URL is missing")

    if not settings.contract_address:
        raise RuntimeError("CONTRACT_ADDRESS is missing")

    web3 = Web3(
        Web3.HTTPProvider(
            settings.sepolia_rpc_url,
            request_kwargs={"timeout": 20}
        )
    )

    chain_id = web3.eth.chain_id

    if chain_id != settings.sepolia_chain_id:
        raise RuntimeError(
            f"Wrong chain: expected {settings.sepolia_chain_id}, got {chain_id}"
        )

    contract_address = Web3.to_checksum_address(
        settings.contract_address
    )

    abi_file = (BACKEND_DIR / settings.abi_path).resolve()

    with abi_file.open("r", encoding="utf-8") as file:
        abi = json.load(file)

    contract = web3.eth.contract(
        address=contract_address,
        abi=abi
    )

    return contract


def get_participant(wallet_address: str):
    contract = create_web3_client()

    wallet = Web3.to_checksum_address(wallet_address)

    result = contract.functions.getParticipant(wallet).call()

    return {
        "wallet": result[0],
        "role": ROLE_NAMES[result[1]],
        "organization_name": result[2],
        "active": result[3]
    }


def verify_product(token_id: int):
    if token_id < 0:
        raise ValueError("Token ID must not be negative")

    contract = create_web3_client()

    status, current_owner = contract.functions.verifyProduct(
        token_id
    ).call()

    return {
        "token_id": str(token_id),
        "status": VERIFICATION_STATUSES[status],
        "current_owner": current_owner
    }


def get_medicine(token_id: int):
    if token_id < 0:
        raise ValueError("Token ID must not be negative")

    contract = create_web3_client()

    status, _ = contract.functions.verifyProduct(token_id).call()

    if status == 0: 
        return None

    batch = contract.functions.getMedicine(token_id).call()

    return {
        "token_id": str(batch[0]),
        "gtin": batch[1],
        "batch_number": batch[2],
        "medicine_name": batch[3],
        "manufacturer": batch[4],
        "manufacture_date": batch[5],
        "expiry_date": batch[6],
        "registered_at": batch[7],
        "lifecycle": LIFECYCLE_NAMES[batch[8]],
        "stage": STAGE_NAMES[batch[9]],
        "metadata_cid": batch[10]
    }


def get_token_owner(token_id: int):
    if token_id < 0:
        raise ValueError("Token ID must not be negative")

    contract = create_web3_client()

    status, _ = contract.functions.verifyProduct(token_id).call()

    if status in (0, 3, 4):
        return None

    return contract.functions.ownerOf(token_id).call()

DOCUMENT_TYPE_IDS = {
    "CERTIFICATE_OF_ORIGIN": 0,
    "QUALITY_CERTIFICATE": 1,
    "CHEMICAL_METADATA": 2
}


def get_document(token_id: int, document_type: str) -> dict:
    if document_type not in DOCUMENT_TYPE_IDS:
        raise ValueError("Unsupported document type")

    contract = create_web3_client()

    result = contract.functions.getDocument(
        token_id,
        DOCUMENT_TYPE_IDS[document_type]
    ).call()

    return {
        "cid": result[1],
        "updated_by": result[2],
        "updated_at": result[3]
    }
