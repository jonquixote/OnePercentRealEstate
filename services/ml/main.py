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

from . import model_store  # noqa: E402

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
    # Wave 2 (optional — the batch path supplies them, the LISTEN path may not)
    lot_sqft: Optional[float] = None
    hoa_fee: Optional[float] = None
    # rent v2 P1/P2: hyperlocal tract key + property history (worker supplies
    # them; older callers omit them and the model uses fallbacks).
    census_tract: Optional[str] = None
    last_sold_price: Optional[float] = None
    last_sold_date: Optional[str] = None
    # ext: tax assessed value
    tax_assessed_value: Optional[float] = None
    # ext: list price for ratio computation (worker supplies from listings.price)
    price: Optional[float] = None
    # ext: days on MLS (market velocity)
    days_on_mls: Optional[float] = None


class PredictResponse(BaseModel):
    predicted_rent: float
    model_version: str
    features_hash: str
    # Wave 2: quantile band (present when the v1 model served the request)
    rent_low: Optional[float] = None
    rent_high: Optional[float] = None


class BatchPredictRequest(BaseModel):
    items: list[PredictRequest] = Field(..., min_length=1, max_length=1000)


class BatchPredictItem(BaseModel):
    listing_id: int
    predicted_rent: float
    rent_low: Optional[float] = None
    rent_high: Optional[float] = None
    model_version: str
    features_hash: str


class BatchPredictResponse(BaseModel):
    results: list[BatchPredictItem]


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
    # Warm this worker's model store before reporting: loading is lazy on
    # the predict path, so a fresh worker that hasn't served a predict yet
    # would report model_loaded_version=null and look broken when it isn't.
    # refresh() is mtime-cached — this is a stat() when already loaded.
    try:
        version = _get_active_version()
        if version.startswith("v1"):
            model_store.refresh(version, _DATABASE_URL)
    except Exception:
        pass  # health reporting must never raise
    return {
        "ok": True,
        "estimator_loaded": estimate_rent_v2 is not None,
        "import_error": _IMPORT_ERR,
        # Feature/model width agreement — False after a mismatch preflight
        # trip (the 2026-07-08 outage class). True until a predict proves
        # otherwise; observable so a bad deploy is caught before the backlog.
        "model_feature_match": model_store.feature_match_ok(),
        "model_loaded_version": model_store.loaded_version(),
        "rent_memory_ready": model_store.rent_memory_ready(),
    }


def _try_model_predict(reqs: list[PredictRequest]) -> Optional[list[dict]]:
    """Score with the active v1 model via the model store. Returns None when
    v1 isn't active/loadable — callers fall back to the v2 triangulation."""
    version = _get_active_version()
    if not version.startswith("v1"):
        return None
    if not model_store.refresh(version, _DATABASE_URL):
        return None
    return model_store.predict_rows(reqs)


def _v2_predict(req: PredictRequest) -> float:
    if estimate_rent_v2 is None:
        raise HTTPException(
            status_code=503,
            detail=f"rent_estimator_v2 not importable: {_IMPORT_ERR}",
        )
    if req.latitude is None or req.longitude is None:
        raise HTTPException(status_code=400, detail="latitude and longitude required")
    try:
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
    return round(float(estimate.estimated_rent or 0.0), 2)


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if req.latitude is None or req.longitude is None:
        # Caller (worker) already screens this, but defense-in-depth: neither
        # path can do anything meaningful without geometry.
        raise HTTPException(status_code=400, detail="latitude and longitude required")

    version = _get_active_version()
    scored = _try_model_predict([req])
    if scored is not None:
        s = scored[0]
        return PredictResponse(
            predicted_rent=s["predicted_rent"],
            rent_low=s["rent_low"],
            rent_high=s["rent_high"],
            model_version=version,
            features_hash=_features_hash(req),
        )

    return PredictResponse(
        predicted_rent=_v2_predict(req),
        model_version=version if not version.startswith("v1") else "v0-fallback",
        features_hash=_features_hash(req),
    )


@app.post("/predict_batch", response_model=BatchPredictResponse)
def predict_batch(req: BatchPredictRequest) -> BatchPredictResponse:
    """Vectorized scoring for the worker's backlog drain. v1 scores the whole
    batch in one matrix pass; the v2 fallback loops (slow but correct)."""
    version = _get_active_version()
    valid = [r for r in req.items if r.latitude is not None and r.longitude is not None]
    if not valid:
        return BatchPredictResponse(results=[])

    scored = _try_model_predict(valid)
    results: list[BatchPredictItem] = []
    if scored is not None:
        for r, s in zip(valid, scored):
            results.append(
                BatchPredictItem(
                    listing_id=r.listing_id,
                    predicted_rent=s["predicted_rent"],
                    rent_low=s["rent_low"],
                    rent_high=s["rent_high"],
                    model_version=version,
                    features_hash=_features_hash(r),
                )
            )
        return BatchPredictResponse(results=results)

    for r in valid:
        try:
            rent = _v2_predict(r)
        except HTTPException:
            continue  # skip the bad row, keep the batch alive
        results.append(
            BatchPredictItem(
                listing_id=r.listing_id,
                predicted_rent=rent,
                model_version=version if not version.startswith("v1") else "v0-fallback",
                features_hash=_features_hash(r),
            )
        )
    return BatchPredictResponse(results=results)


# ---------------------------------------------------------------------------
# Wave 7: Ops endpoints (drift + eval on demand)
# ---------------------------------------------------------------------------


class OpResponse(BaseModel):
    ok: bool
    lines: list[str] = []
    alert: bool = False
    exit_code: Optional[int] = None


async def _run_subprocess(cmd: list[str], timeout_s: float = 120.0) -> tuple[bool, list[str], int]:
    """Run a subprocess and capture stdout/stderr. Return (ok, lines, exit_code)."""
    import asyncio

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        output = stdout.decode("utf-8", errors="replace").strip()
        lines = output.split("\n") if output else []

        if proc.returncode == 0:
            return True, lines, 0
        else:
            return False, lines, proc.returncode if proc.returncode is not None else 1

    except asyncio.TimeoutError:
        return False, [f"timeout: subprocess exceeded {timeout_s:.0f}s"], 124
    except Exception as exc:
        return False, [f"subprocess error: {exc}"], 1


@app.post("/ops/refresh-market-stats", response_model=OpResponse)
async def refresh_market_stats() -> OpResponse:
    """Refresh H3 market stats + address rent history. Synchronous — the
    scheduler's 10-minute timeout covers both surfaces."""
    import psycopg2
    from ml_rent_estimator.market_stats import refresh

    conn = None
    try:
        conn = psycopg2.connect(_DATABASE_URL)
        result = refresh(conn)
        lines = [f"{k}: {v}" for k, v in result.items()]
        alert = any("error" in k for k in result)
        return OpResponse(ok=True, lines=lines, exit_code=0, alert=alert)
    except Exception as exc:
        return OpResponse(ok=False, lines=[str(exc)], exit_code=1, alert=True)
    finally:
        if conn is not None:
            conn.close()


@app.post("/ops/run-drift", response_model=OpResponse)
async def run_drift() -> OpResponse:
    """Trigger the drift monitor. Captures stdout and returns JSON."""
    # sys.executable, not bare "python": under systemd the venv is not on
    # PATH (this broke the nightly drift job after the 2026-07-09 cutover).
    ok, lines, exit_code = await _run_subprocess([sys.executable, "-m", "services.ml.drift"])

    # Simple heuristic: if there are "WARNING" or "ERROR" lines, alert.
    alert = any("WARNING" in line or "ERROR" in line for line in lines)

    return OpResponse(ok=ok, lines=lines, exit_code=exit_code, alert=alert)


@app.post("/ops/run-eval", response_model=OpResponse)
async def run_eval() -> OpResponse:
    """Trigger model evaluation. Captures stdout and returns JSON."""
    ok, lines, exit_code = await _run_subprocess([sys.executable, "-m", "services.ml.eval"])

    # Simple heuristic: if there are "WARNING" or "ERROR" lines, alert.
    alert = any("WARNING" in line or "ERROR" in line for line in lines)

    return OpResponse(ok=ok, lines=lines, exit_code=exit_code, alert=alert)


@app.post("/ops/run-train", response_model=OpResponse)
async def run_train() -> OpResponse:
    """Wave 2 nightly retrain: train into a staging dir, run the eval gate
    against staging, and promote by atomic directory swap only on gate PASS.
    The previous artifacts are kept as rent_v1_backup (manual rollback:
    swap the directories back). The eval gate IS the auto-rollback — a worse
    candidate never reaches the serving path.
    """
    import shutil

    model_dir = os.environ.get("MODEL_DIR", "/models")
    staging = os.path.join(model_dir, "rent_v1_staging")
    live = os.path.join(model_dir, "rent_v1")
    backup = os.path.join(model_dir, "rent_v1_backup")

    lines: list[str] = []

    ok, out, code = await _run_subprocess(
        [sys.executable, "-m", "ml_rent_estimator.train_v1", "rent_v1_staging"], timeout_s=1800.0
    )
    lines += out[-8:]
    if not ok:
        return OpResponse(ok=False, lines=["TRAIN FAILED"] + lines, exit_code=code, alert=True)

    gate_ok, out, code = await _run_subprocess(
        [sys.executable, "-m", "ml_rent_estimator.eval_v1", "rent_v1_staging"], timeout_s=900.0
    )
    lines += out[-12:]
    if not gate_ok:
        # Candidate lost to the gate. Keep serving the current model; leave
        # staging on disk for inspection.
        return OpResponse(
            ok=True, lines=["GATE FAIL — kept current model"] + lines, exit_code=code, alert=True
        )

    try:
        if os.path.isdir(backup):
            shutil.rmtree(backup)
        if os.path.isdir(live):
            os.rename(live, backup)
        os.rename(staging, live)

        # Initialize the canary state file for the newly promoted model
        try:
            canary_path = os.path.join(model_dir, "canary_state.json")
            with open(canary_path, "w") as f:
                json.dump({"remaining": 200, "deviations": []}, f)
            log.info("initialized canary shadow window with 200 predictions")
        except Exception as exc:
            log.warning("failed to initialize canary state file: %s", exc)
    except OSError as exc:
        return OpResponse(
            ok=False, lines=[f"PROMOTE SWAP FAILED: {exc}"] + lines, exit_code=1, alert=True
        )

    # Ensure the registry row is active (it usually already is; idempotent).
    # Must set promoted_at so the ops team knows when the model went live.
    activation_ok = True
    if _DATABASE_URL:
        conn = None
        try:
            conn = psycopg2.connect(_DATABASE_URL)
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE rent_models SET active = (version = 'v1'), "
                    "promoted_at = CASE WHEN version = 'v1' THEN NOW() ELSE promoted_at END"
                )
            conn.commit()
        except Exception as exc:  # pragma: no cover
            log.critical("activation update failed: %s", exc)
            activation_ok = False
        finally:
            if conn is not None:
                conn.close()

    if not activation_ok:
        return OpResponse(
            ok=False, lines=["PROMOTED ON DISK BUT ACTIVATION FAILED"] + lines, exit_code=1, alert=True
        )

    # Append the promoted model's eval report to the rolling history (a
    # queryable record of every promote's metrics — ratchets become visible,
    # and eval_v1.rolling_min_highvar() can read it for a stricter gate).
    # The report rode along inside the swapped dir, so it is now at live/.
    try:
        report_path = os.path.join(live, "eval_report.json")
        if os.path.isfile(report_path):
            with open(report_path) as f:
                report = json.load(f)
            report["promoted_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
            with open(os.path.join(model_dir, "eval_history.jsonl"), "a") as f:
                f.write(json.dumps(report) + "\n")
    except (OSError, ValueError) as exc:  # history is observability, never block a good promote
        log.warning("eval_history append failed: %s", exc)

    return OpResponse(ok=True, lines=["PROMOTED"] + lines, exit_code=0, alert=False)
