from pathlib import Path

from pydantic import BaseModel, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class SensorRegistration(BaseModel):
    public_key: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    token_ids: list[str]
    source: str = "simulator"
    calibration: str = "Uncalibrated demo"


class Settings(BaseSettings):
    oracle_sensors: dict[str, SensorRegistration] = {}
    sepolia_rpc_url: str = ""
    sepolia_chain_id: int = 11155111
    contract_address: str = ""
    frontend_origin: str = "http://localhost:5173"
    database_url: str = "sqlite:///./dsct.db"
    abi_path: str = "../shared/abi/DrugSupplyChain.json"
    cookie_secure: bool = False
    pinata_jwt: str = ""
    price_key_v1: SecretStr = SecretStr("")
    chain_confirmations: int = Field(6, ge=1)
    deployment_block: int = Field(12153539, ge=0)
    indexer_chunk_size: int = Field(10, ge=1, le=2000)
    document_key_v1: SecretStr = SecretStr("")

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        extra="ignore"
    )


settings = Settings()