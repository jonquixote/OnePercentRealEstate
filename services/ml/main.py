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
import time
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

# Active-version lookup is cached for 60s so /predict doesn't pay a
# connection handshake per request — and the connection is explicitly
# closed ("with psycopg2.connect()" only ends the transaction, which is
# how the previous version leaked one connection per prediction and OOM-
# killed the container every ~2 minutes on 2026-07-05).
_VERSION_TTL_S = 60.0
_version_cache: tuple[float, str] = (0.0, "v0")


def _get_active_version() -> str:
    """Read the active model version from rent_models, cached 60s.

    Falls back to 'v0' (the baseline seed in 2026_06_03_rent_model_registry)
    if the table is absent — keeps local imports cheap during tests where
    the registry migration hasn't been applied.
    """
    global _version_cache
    now = time.monotonic()
    cached_at, cached = _version_cache
    if now - cached_at < _VERSION_TTL_S:
        return cached
    version = "v0"
    if _DATABASE_URL:
        conn = None
        try:
            conn = psycopg2.connect(_DATABASE_URL)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT version FROM rent_models WHERE active = true LIMIT 1"
                )
                row = cur.fetchone()
                if row and row[0]:
                    version = str(row[0])
        except Exception as exc:  # pragma: no cover — degrade not crash
            log.warning("rent_models lookup failed: %s", exc)
        finally:
            if conn is not None:
                conn.close()
    _version_cache = (now, version)
    return version


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


# ---------------------------------------------------------------------------
# Wave 7: Ops endpoints (drift + eval on demand)
# ---------------------------------------------------------------------------


class OpResponse(BaseModel):
    ok: bool
    lines: list[str] = []
    alert: bool = False
    exit_code: Optional[int] = None


async def _run_subprocess(cmd: list[str]) -> tuple[bool, list[str], int]:
    """Run a subprocess and capture stdout/stderr. Return (ok, lines, exit_code)."""
    import asyncio

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=120.0)
        output = stdout.decode("utf-8", errors="replace").strip()
        lines = output.split("\n") if output else []

        if proc.returncode == 0:
            return True, lines, 0
        else:
            return False, lines, proc.returncode

    except asyncio.TimeoutError:
        return False, ["timeout: subprocess exceeded 120s"], 124
    except Exception as exc:
        return False, [f"subprocess error: {exc}"], 1


@app.post("/ops/run-drift", response_model=OpResponse)
async def run_drift() -> OpResponse:
    """Trigger the drift monitor. Captures stdout and returns JSON."""
    ok, lines, exit_code = await _run_subprocess(["python", "-m", "drift"])

    # Simple heuristic: if there are "WARNING" or "ERROR" lines, alert.
    alert = any("WARNING" in line or "ERROR" in line for line in lines)

    return OpResponse(ok=ok, lines=lines, exit_code=exit_code, alert=alert)


@app.post("/ops/run-eval", response_model=OpResponse)
async def run_eval() -> OpResponse:
    """Trigger model evaluation. Captures stdout and returns JSON."""
    ok, lines, exit_code = await _run_subprocess(["python", "-m", "eval"])

    # Simple heuristic: if there are "WARNING" or "ERROR" lines, alert.
    alert = any("WARNING" in line or "ERROR" in line for line in lines)

    return OpResponse(ok=ok, lines=lines, exit_code=exit_code, alert=alert)
