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

# Backup/incumbent model for canary shadow comparison
_backup_boosters: Optional[dict[str, Any]] = None
_backup_meta: Optional[dict] = None

_hud: dict[tuple[str, int], float] = {}
_hud_loaded_at: float = 0.0
_HUD_TTL_S = 24 * 3600

_zcta: dict[str, tuple[float | None, float | None]] = {}
_zcta_loaded_at: float = 0.0
_ZCTA_TTL_S = 24 * 3600

# P3: multi-vintage caches for trajectory features
_hud_3yr_ago: dict[tuple[str, int], float] = {}  # (zip, beds) -> safmr from 3 FYs ago
_zcta_old: dict[str, tuple[float | None, float | None]] = {}  # zip -> (income, rent) ~5yr ago

# P2: prior rent memory (async-loaded, non-blocking)
_rent_memory: dict[str, tuple[float, str]] = {}  # {address_norm: (last_rent, last_rent_date)}
_rent_memory_loaded_at: float = 0.0
_RENT_MEMORY_TTL_S = 6 * 3600
_rent_memory_ready: bool = False
_rent_memory_warned: bool = False

# Set False by the predict-time preflight when the built vector width does
# not match the loaded booster's expected feature count. Surfaced on
# /healthz so a feature/model mismatch (the 2026-07-08 outage class) is
# observable instead of silently degrading to the v2 fallback.
_feature_match_ok: bool = True


def loaded_version() -> Optional[str]:
    return _loaded_version


def feature_match_ok() -> bool:
    return _feature_match_ok


def rent_memory_ready() -> bool:
    return _rent_memory_ready


def refresh(active_version: str, database_url: Optional[str]) -> bool:
    """Ensure artifacts for active_version are loaded. Returns True when the
    store can serve that version."""
    global _boosters, _meta, _loaded_version, _loaded_meta_mtime
    global _backup_boosters, _backup_meta
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

        # Load backup model if available
        backup_dir = os.path.join(MODEL_DIR, "rent_v1_backup")
        backup_meta_path = os.path.join(backup_dir, "metadata.json")
        backup_boosters = None
        backup_meta = None
        if os.path.exists(backup_meta_path):
            try:
                with open(backup_meta_path) as f:
                    backup_meta = json.load(f)
                backup_boosters = {
                    q: lgb.Booster(model_file=os.path.join(backup_dir, f"{q}.txt"))
                    for q in ("p10", "p50", "p90")
                }
                log.info("loaded backup model for canary shadow comparison")
            except Exception as exc:
                log.warning("failed to load backup model: %s", exc)

        _boosters, _meta, _loaded_version = boosters, meta, active_version
        _loaded_meta_mtime = os.path.getmtime(meta_path)
        _backup_boosters, _backup_meta = backup_boosters, backup_meta
        log.info("model store loaded %s (train_rows=%s)", active_version, meta.get("train_rows"))
        _maybe_refresh_hud(database_url, force=not _hud or not _zcta)
        if database_url:
            _maybe_refresh_rent_memory(database_url, force=not _rent_memory)
        return True
    except Exception as exc:
        log.warning("model load failed for %s: %s", active_version, exc)
        return False


def _maybe_refresh_hud(database_url: Optional[str], force: bool = False) -> None:
    global _hud, _hud_loaded_at, _zcta, _zcta_loaded_at
    if not database_url:
        return
    needs_hud = force or not ((time.monotonic() - _hud_loaded_at) < _HUD_TTL_S and _hud)
    needs_zcta = force or not ((time.monotonic() - _zcta_loaded_at) < _ZCTA_TTL_S and _zcta)
    if not needs_hud and not needs_zcta:
        return
    try:
        import psycopg2

        conn = psycopg2.connect(database_url)
        try:
            with conn.cursor() as cur:
                if needs_hud:
                    cur.execute(
                        """SELECT DISTINCT ON (zip_code, bedrooms) zip_code, bedrooms, safmr
                           FROM hud_safmr ORDER BY zip_code, bedrooms, fy DESC"""
                    )
                    _hud = {(z, int(b)): float(s) for z, b, s in cur.fetchall()}
                    _hud_loaded_at = time.monotonic()
                    log.info("hud cache loaded: %d entries", len(_hud))
                    # P3: HUD from ~3 FYs ago for fmr_cagr_3yr
                    import datetime as _dt
                    fy_cutoff = _dt.date.today().year - 3
                    cur.execute(
                        """SELECT DISTINCT ON (zip_code, bedrooms) zip_code, bedrooms, safmr
                           FROM hud_safmr WHERE fy <= %s
                           ORDER BY zip_code, bedrooms, fy DESC""",
                        (fy_cutoff,),
                    )
                    global _hud_3yr_ago
                    _hud_3yr_ago = {(z, int(b)): float(s) for z, b, s in cur.fetchall()}
                    log.info("hud_3yr_ago cache loaded: %d entries (fy<=%d)", len(_hud_3yr_ago), fy_cutoff)
                if needs_zcta:
                    cur.execute(
                        """SELECT DISTINCT ON (zcta) zcta, median_hh_income, median_gross_rent
                           FROM zcta_demographics ORDER BY zcta, acs_year DESC"""
                    )
                    _zcta = {z: (income, rent) for z, income, rent in cur.fetchall()}
                    _zcta_loaded_at = time.monotonic()
                    log.info("zcta cache loaded: %d entries", len(_zcta))
                    # P3: ZCTA from ~5 years ago for growth features
                    import datetime as _dt
                    yr_cutoff = _dt.date.today().year - 4
                    cur.execute(
                        """SELECT DISTINCT ON (zcta) zcta, median_hh_income, median_gross_rent
                           FROM zcta_demographics WHERE acs_year <= %s
                           ORDER BY zcta, acs_year DESC""",
                        (yr_cutoff,),
                    )
                    global _zcta_old
                    _zcta_old = {z: (income, rent) for z, income, rent in cur.fetchall()}
                    log.info("zcta_old cache loaded: %d entries (yr<=%d)", len(_zcta_old), yr_cutoff)
        finally:
            conn.close()
    except Exception as exc:
        log.warning("hud/zcta cache refresh failed: %s", exc)


def _maybe_refresh_rent_memory(database_url: str, force: bool = False) -> None:
    global _rent_memory, _rent_memory_loaded_at, _rent_memory_ready, _rent_memory_warned
    if not force and _rent_memory and (time.monotonic() - _rent_memory_loaded_at) < _RENT_MEMORY_TTL_S:
        return
    import threading
    def _load():
        global _rent_memory, _rent_memory_loaded_at, _rent_memory_ready, _rent_memory_warned
        try:
            import psycopg2
            conn = psycopg2.connect(database_url)
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT address_norm, last_rent, last_rent_date::text FROM address_rent_history")
                    mem = {r[0]: (float(r[1]), r[2]) for r in cur.fetchall()}
                _rent_memory = mem
                _rent_memory_loaded_at = time.monotonic()
                _rent_memory_ready = True
                _rent_memory_warned = False
                log.info("rent_memory loaded: %d addresses", len(mem))
            finally:
                conn.close()
        except Exception as exc:
            log.warning("rent_memory load failed (table may not exist yet): %s", exc)
    threading.Thread(target=_load, daemon=True).start()


def _row_from_request(req: Any) -> dict:
    beds = req.bedrooms if req.bedrooms is not None else 2
    zip_code = str(req.zip_code or "")
    hud = _hud.get((zip_code, int(min(max(beds or 0, 0), 4))))
    zcta = _zcta.get(zip_code, (None, None))

    # P2: pass through sale history from request payload
    last_sold_price = getattr(req, "last_sold_price", None)
    last_sold_date = getattr(req, "last_sold_date", None)

    # ext: tax assessed value
    tax_assessed_value = getattr(req, "tax_assessed_value", None)
    price = getattr(req, "price", None)

    # P2: prior rent from memory cache
    prior_rent = None
    prior_rent_date = None
    address = getattr(req, "address", None)
    if address and _rent_memory:
        import re
        addr_norm = re.sub(r'\s+', ' ', address.strip()).lower()
        mem = _rent_memory.get(addr_norm)
        if mem:
            prior_rent, prior_rent_date = mem
    elif address and not _rent_memory_ready:
        global _rent_memory_warned
        if not _rent_memory_warned:
            _rent_memory_warned = True
            log.warning("rent_memory not ready; prior_rent features will be sentinel")

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
        "census_tract": getattr(req, "census_tract", None),
        "hud_safmr": hud,
        "zcta_med_income": zcta[0],
        "zcta_med_rent": zcta[1],
        # P2 property history
        "last_sold_price": last_sold_price,
        "last_sold_date": last_sold_date,
        "prior_rent": prior_rent,
        "prior_rent_date": prior_rent_date,
        # P3 trajectory anchors
        "hud_safmr_3yr_ago": _hud_3yr_ago.get((zip_code, int(min(max(beds or 0, 0), 4)))),
        "zcta_med_income_5yr_ago": _zcta_old.get(zip_code, (None, None))[0],
        "zcta_med_rent_5yr_ago": _zcta_old.get(zip_code, (None, None))[1],
        # ext: tax assessed value
        "tax_assessed_value": tax_assessed_value,
        "rent": price,  # list price for list_to_assessed_ratio (serving path)
    }


def fire_canary_alert(msg: str) -> None:
    webhook_url = os.environ.get("OPS_WEBHOOK_URL")
    if not webhook_url:
        log.warning("canary alert suppressed (OPS_WEBHOOK_URL not set): %s", msg)
        return
    try:
        import urllib.request
        payload = {
            "text": "ML Canary Alert",
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*ML Canary Alert*\n{msg}"
                    }
                }
            ]
        }
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            pass
        log.info("canary alert webhook sent: %s", msg)
    except Exception as exc:
        log.error("failed to send canary alert webhook: %s", exc)


def update_canary_state(listing_id: int, new_val: float, old_val: float) -> Optional[int]:
    """Updates the canary state file with file locking (fcntl.flock) to avoid
    race conditions between uvicorn processes. Returns the remaining count
    after the update, or None if the canary window is closed."""
    state_path = os.path.join(MODEL_DIR, "canary_state.json")
    if not os.path.exists(state_path):
        return None
    try:
        import fcntl
        with open(state_path, "r+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                data = json.load(f)
                remaining = data.get("remaining", 0)
                if remaining <= 0:
                    return 0
                
                deviation = abs(new_val - old_val)
                deviations = data.get("deviations", [])
                deviations.append({
                    "listing_id": listing_id,
                    "new_p50": new_val,
                    "old_p50": old_val,
                    "deviation": deviation
                })
                
                remaining -= 1
                data["remaining"] = remaining
                data["deviations"] = deviations
                
                f.seek(0)
                f.truncate()
                json.dump(data, f)
                
                if remaining == 0:
                    devs = [d["deviation"] for d in deviations]
                    if devs:
                        import numpy as np
                        med_dev = float(np.median(devs))
                        log.info("Canary shadow window completed. Median absolute deviation: $%.2f", med_dev)
                        if med_dev > 300.0:
                            msg = f"Canary shadow window failed: median absolute deviation is ${med_dev:.2f} (exceeds limit $300.00)"
                            fire_canary_alert(msg)
                
                return remaining
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
    except Exception as exc:
        log.warning("failed to update canary state: %s", exc)
        return None


def predict_rows(reqs: list[Any]) -> Optional[list[dict]]:
    """Score a list of PredictRequest-shaped objects. Returns None when the
    store has no model (caller falls back to v2)."""
    if not _boosters or _meta is None:
        return None
    import numpy as np

    from ml_rent_estimator.dataset import build_feature_row

    global _feature_match_ok
    try:
        X = np.asarray([build_feature_row(_row_from_request(r), _meta) for r in reqs], dtype=float)
        # Preflight: the built vector width MUST equal what the booster was
        # trained on. A mismatch means FEATURE_NAMES and the artifact have
        # diverged (stale model vs new code, or vice versa) — scoring anyway
        # yields a LightGBMError per row and, worse, silently condemns the
        # backlog. Fail closed to the v2 fallback and flag it for /healthz.
        n_expected = _boosters["p50"].num_feature()
        if X.shape[1] != n_expected:
            _feature_match_ok = False
            log.critical(
                "feature count mismatch: built %d, model expects %d — check "
                "FEATURE_NAMES vs artifact metadata; serving v2 fallback",
                X.shape[1], n_expected,
            )
            return None
        _feature_match_ok = True
        p10 = np.exp(np.asarray(_boosters["p10"].predict(X), dtype=float))
        p50 = np.exp(np.asarray(_boosters["p50"].predict(X), dtype=float))
        p90 = np.exp(np.asarray(_boosters["p90"].predict(X), dtype=float))

        # Canary shadow predictions run if backup model is loaded
        if _backup_boosters and _backup_meta:
            try:
                X_backup = np.asarray([build_feature_row(_row_from_request(r), _backup_meta) for r in reqs], dtype=float)
                n_expected_backup = _backup_boosters["p50"].num_feature()
                if X_backup.shape[1] == n_expected_backup:
                    p50_backup = np.exp(np.asarray(_backup_boosters["p50"].predict(X_backup), dtype=float))
                    for r, val_new, val_old in zip(reqs, p50, p50_backup):
                        listing_id = getattr(r, "listing_id", None)
                        if listing_id:
                            log.info("Canary prediction: listing_id=%s, old_p50=%.2f, new_p50=%.2f", listing_id, val_old, val_new)
                            update_canary_state(int(listing_id), float(val_new), float(val_old))
                else:
                    log.warning("backup model feature count mismatch: built %d, model expects %d", X_backup.shape[1], n_expected_backup)
            except Exception as exc:
                log.warning("canary prediction failed: %s", exc)

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
        log.warning("v1 predict_rows failed — falling back to v2: %s", exc, exc_info=True)
        return None
