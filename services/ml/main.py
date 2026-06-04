"""FastAPI shim around services/rent_estimator_v2.py.

Wave 3 makes rent calculation asynchronous. The Node worker
(apps/worker/src/rent-estimator.ts) POSTs listing payloads here; this
service runs the existing weighted triangulation and stamps the active
model version onto the response.

The math itself is NOT reimplemented — we import `estimate_rent_v2` from
the legacy module so the migration off the SQL trigger is behavior-
preserving. When a real ML model lands in a later iteration, we swap
the inner call without touching the worker or the wire contract.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# The legacy estimator lives one directory up. The Docker image COPYs it
# in at /app/rent_estimator_v2.py so this sys.path tweak is for local
# `python -c "import services.ml.main"` smoke tests only.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_THIS_DIR)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

# The estimator module imports `dotenv` at module load — we provide a
# no-op fallback for environments that don't have it (e.g. when this
# module is imported for a smoke test outside the Docker image).
try:
    from rent_estimator_v2 import estimate_rent_v2  # type: ignore
except Exception as _import_err:  # pragma: no cover — surfaced at runtime
    estimate_rent_v2 = None  # type: ignore
    _IMPORT_ERR: Optional[str] = repr(_import_err)
else:
    _IMPORT_ERR = None

import psycopg2  # noqa: E402

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s","service":"ml"}',
)
log = logging.getLogger("ml")


# ---------------------------------------------------------------------------
# Wire contract
# ---------------------------------------------------------------------------


class PredictRequest(BaseModel):
    listing_id: int = Field(..., ge=1)
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[float] = None
    sqft: Optional[int] = None
    year_built: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    property_type: Optional[str] = None


class PredictResponse(BaseModel):
    predicted_rent: float
    model_version: str
    features_hash: str


# ---------------------------------------------------------------------------
# Active model lookup
# ---------------------------------------------------------------------------


_DATABASE_URL = os.getenv("DATABASE_URL")


def _get_active_version() -> str:
    """Read the active model version from rent_models.

    Falls back to 'v0' (the baseline seed in 2026_06_03_rent_model_registry)
    if the table is absent — keeps local imports cheap during tests where
    the registry migration hasn't been applied.
    """
    if not _DATABASE_URL:
        return "v0"
    try:
        with psycopg2.connect(_DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT version FROM rent_models WHERE active = true LIMIT 1"
                )
                row = cur.fetchone()
                if row and row[0]:
                    return str(row[0])
    except Exception as exc:  # pragma: no cover — degrade not crash
        log.warning("rent_models lookup failed: %s", exc)
    return "v0"


def _features_hash(req: PredictRequest) -> str:
    """Deterministic hash of the feature vector for audit + drift."""
    payload = json.dumps(
        {
            "beds": req.bedrooms,
            "baths": req.bathrooms,
            "sqft": req.sqft,
            "year_built": req.year_built,
            "zip": req.zip_code,
            "property_type": req.property_type,
            # Lat/lon rounded to 4 decimals (~11m) so trivial geocode
            # jitter doesn't fragment otherwise-identical features.
            "lat": round(req.latitude, 4) if req.latitude is not None else None,
            "lon": round(req.longitude, 4) if req.longitude is not None else None,
        },
        sort_keys=True,
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------


app = FastAPI(
    title="services-ml",
    version="0.1.0",
    description="Async rent prediction shim. Wraps the legacy "
    "rent_estimator_v2 triangulation behind a model-registry-aware HTTP "
    "endpoint.",
)


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "estimator_loaded": estimate_rent_v2 is not None,
        "import_error": _IMPORT_ERR,
    }


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if estimate_rent_v2 is None:
        raise HTTPException(
            status_code=503,
            detail=f"rent_estimator_v2 not importable: {_IMPORT_ERR}",
        )

    if req.latitude is None or req.longitude is None:
        # Caller (worker) already screens this, but defense-in-depth: the
        # estimator can't do anything without geometry.
        raise HTTPException(status_code=400, detail="latitude and longitude required")

    try:
        # No type annotation: RentEstimate may be None at runtime if the
        # legacy module failed to import (we guard above with the `is None`
        # check), and pyright won't let us use a possibly-None symbol as a
        # type. Behavior is unchanged.
        estimate = estimate_rent_v2(
            lat=float(req.latitude),
            lon=float(req.longitude),
            bedrooms=int(req.bedrooms) if req.bedrooms is not None else 0,
            bathrooms=float(req.bathrooms) if req.bathrooms is not None else None,
            sqft=int(req.sqft) if req.sqft is not None else None,
            zip_code=req.zip_code,
            property_type=req.property_type,
            year_built=req.year_built,
        )
    except Exception as exc:  # noqa: BLE001 — surface as 5xx
        log.exception("estimator raised for listing_id=%s", req.listing_id)
        raise HTTPException(status_code=500, detail=f"estimator error: {exc}") from exc

    return PredictResponse(
        predicted_rent=round(float(estimate.estimated_rent or 0.0), 2),
        model_version=_get_active_version(),
        features_hash=_features_hash(req),
    )
