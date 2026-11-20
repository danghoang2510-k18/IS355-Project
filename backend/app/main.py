from contextlib import asynccontextmanager

from fastapi import FastAPI
from app.core.database import init_database
from fastapi.middleware.cors import CORSMiddleware
from app.api.auth import router as auth_router
from app.core.config import settings
from app.api.metadata import router as metadata_router
from app.api.documents import router as documents_router
from app.api.batches import router as batches_router
from app.api.oracle import router as oracle_router
from app.api.prices import router as prices_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_database()
    yield


app = FastAPI(
    lifespan=lifespan,
    title="DSCT Backend API",
    version="0.1.0"
)

app.include_router(auth_router)
app.include_router(documents_router)
app.include_router(metadata_router)
app.include_router(prices_router)
app.include_router(oracle_router)
app.include_router(batches_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"]
)


@app.get("/api/v1/health")
def health():
    return {
        "data": {
            "status": "ok",
            "service": "dsct-backend",
            "version": "0.1.0"
        },
        "meta": {}
    }