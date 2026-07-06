"""Model store for the rent service: loads the active LightGBM v1 artifacts
from MODEL_DIR and scores rows with the SAME feature builder training used
(ml_rent_estimator.dataset.build_feature_row — drift-proof by construction).

Design:
  - refresh() is cheap and called behind the existing 60s active-version
    cache in main.py; it only touches disk when the active version changes.
  - HUD SAFMR is preloaded into a dict (~193K rows, ~20MB) and refreshed
    every 24h — batch scoring must not do a DB lookup per row.
  - Any load failure leaves the store empty; callers fall back to the v2
    triangulation. The service never crashes because a model is missing.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

log = logging.getLogger("ml.model_store")

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")

_boosters: dict[str, Any] = {}
_meta: Optional[dict] = None
_loaded_version: Optional[str] = None
_loaded_meta_mtime: float = 0.0

_hud: dict[tuple[str, int], float] = {}
_hud_loaded_at: float = 0.0
_HUD_TTL_S = 24 * 3600


def loaded_version() -> Optional[str]:
    return _loaded_version


def refresh(active_version: str, database_url: Optional[str]) -> bool:
    """Ensure artifacts for active_version are loaded. Returns True when the
    store can serve that version."""
    global _boosters, _meta, _loaded_version, _loaded_meta_mtime
    out_dir = os.path.join(MODEL_DIR, "rent_v1")
    meta_path = os.path.join(out_dir, "metadata.json")
    if active_version == _loaded_version and _boosters:
        # Nightly retrain promotes by atomically swapping the artifact dir —
        # the version string stays 'v1', so staleness is detected via the
        # metadata mtime. All uvicorn workers converge within the caller's
        # 60s version-cache window.
        try:
            if os.path.getmtime(meta_path) == _loaded_meta_mtime:
                _maybe_refresh_hud(database_url)
                return True
        except OSError:
            return True  # artifacts briefly mid-swap: keep serving what we have
    if not active_version.startswith("v1"):
        return False
    try:
        import lightgbm as lgb

        with open(meta_path) as f:
            meta = json.load(f)
        boosters = {
            q: lgb.Booster(model_file=os.path.join(out_dir, f"{q}.txt"))
            for q in ("p10", "p50", "p90")
        }
        _boosters, _meta, _loaded_version = boosters, meta, active_version
        _loaded_meta_mtime = os.path.getmtime(meta_path)
        log.info("model store loaded %s (train_rows=%s)", active_version, meta.get("train_rows"))
        _maybe_refresh_hud(database_url, force=not _hud)
        return True
    except Exception as exc:
        log.warning("model load failed for %s: %s", active_version, exc)
        return False


def _maybe_refresh_hud(database_url: Optional[str], force: bool = False) -> None:
    global _hud, _hud_loaded_at
    if not database_url:
        return
    if not force and (time.monotonic() - _hud_loaded_at) < _HUD_TTL_S and _hud:
        return
    try:
        import psycopg2

        conn = psycopg2.connect(database_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT DISTINCT ON (zip_code, bedrooms) zip_code, bedrooms, safmr
                       FROM hud_safmr ORDER BY zip_code, bedrooms, fy DESC"""
                )
                _hud = {(z, int(b)): float(s) for z, b, s in cur.fetchall()}
        finally:
            conn.close()
        _hud_loaded_at = time.monotonic()
        log.info("hud cache loaded: %d entries", len(_hud))
    except Exception as exc:
        log.warning("hud cache refresh failed: %s", exc)


def _row_from_request(req: Any) -> dict:
    beds = req.bedrooms if req.bedrooms is not None else 2
    zip_code = str(req.zip_code or "")
    hud = _hud.get((zip_code, int(min(max(beds or 0, 0), 4))))
    return {
        "beds": req.bedrooms,
        "baths": req.bathrooms,
        "sqft": req.sqft,
        "year_built": req.year_built,
        "lot_sqft": getattr(req, "lot_sqft", None),
        "hoa_fee": getattr(req, "hoa_fee", None),
        "lat": req.latitude,
        "lng": req.longitude,
        "ptype": req.property_type,
        "zip": zip_code,
        "hud_safmr": hud,
    }


def predict_rows(reqs: list[Any]) -> Optional[list[dict]]:
    """Score a list of PredictRequest-shaped objects. Returns None when the
    store has no model (caller falls back to v2)."""
    if not _boosters or _meta is None:
        return None
    import numpy as np

    from ml_rent_estimator.dataset import build_feature_row

    try:
        X = np.asarray([build_feature_row(_row_from_request(r), _meta) for r in reqs], dtype=float)
        p10 = np.exp(np.asarray(_boosters["p10"].predict(X), dtype=float))
        p50 = np.exp(np.asarray(_boosters["p50"].predict(X), dtype=float))
        p90 = np.exp(np.asarray(_boosters["p90"].predict(X), dtype=float))
        out = []
        for i in range(len(reqs)):
            lo = float(min(p10[i], p50[i]))
            hi = float(max(p90[i], p50[i]))
            out.append(
                {
                    "predicted_rent": round(float(p50[i]), 2),
                    "rent_low": round(lo, 2),
                    "rent_high": round(hi, 2),
                }
            )
        return out
    except Exception as exc:
        log.warning("v1 predict_rows failed \u2014 falling back to v2: %s", exc)
        return None
