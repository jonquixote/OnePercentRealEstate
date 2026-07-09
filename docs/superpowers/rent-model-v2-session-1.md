Let me ground in the files I haven't yet read, then start P0.

  Read 2 files

Now the ML service main — the /ops/run-train promote flow, /predict, /healthz:

  Read 1 file

Full context now in hand. The /ops/run-train already snapshots rent_v1_backup (line 397-400) — rollback path confirmed. HUD baseline is hardcoded to column index 10 (fragile once features append — I'll fix to name-lookup in P0.2).

Let me set up the Python test loop. The test_dataset.py unit tests need only pandas/numpy/pytest (no lightgbm), so runnable locally:

  Ran 1 shell command

Local stack good (pandas 3.0.2, pytest 9.0.3). Starting P0.1 — meta-order vectors + preflight. Writing the failing test first (TDD):

⏺ Write(ml_rent_estimator/test_dataset.py)
Wrote 76 lines to ml_rent_estimator/test_dataset.py
"""Unit tests for the feature builder. These cover only pure-python feature
logic (no lightgbm), so they run anywhere pandas/numpy are present:

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_dataset.py -v
"""
import math

import pytest

from ml_rent_estimator.dataset import (
… +66 lines

  Ran 1 shell command
Found 2 new diagnostic issues in 1 file (ctrl+o to expand)

Fails as expected. Now refactor dataset.py — split into compute_features (named dict) + vector_from_features (meta-ordered):

⏺ Update(ml_rent_estimator/dataset.py)
Added 49 lines, removed 18 lines
    return float(meta.get(global_key, hardcoded))


def build_feature_row(row: dict[str, Any], meta: dict) -> list[float]:
    """row keys: beds, baths, sqft, year_built, lot_sqft, hoa_fee, lat, lng,
    ptype, zip, hud_safmr (any may be None/NaN). Mirrors training exactly."""
def compute_features(row: dict[str, Any], meta: dict, asof: Any = None) -> dict[str, float]:
    """Compute EVERY registered feature for a row, keyed by feature name.

    Returns a superset dict — it always computes the current module's full
    FEATURE_NAMES set. Serving emits a subset in the artifact's order via
    vector_from_features(), which is how new code stays able to serve an
    older (shorter) model artifact after a deploy (incident 2026-07-08).

    `asof` (a date) is the reference point for time-relative history features
    (Phase 2+); defaults to today for serving, the listing_date for training.
    Not consumed by any current feature — plumbed for forward compatibility.

    row keys: beds, baths, sqft, year_built, lot_sqft, hoa_fee, lat, lng,
    ptype, zip, hud_safmr, zcta_med_income, zcta_med_rent (any may be
    None/NaN). Mirrors training exactly.
    """

    def num(v, default):
        try:
            f = float(v)

        meta, "zcta_rent_global_median", 1000.0,
    )

    return [
        beds,
        baths,
        math.log(max(sqft, 100.0)),
        year_built,
        math.log1p(max(lot, 0.0)),
        hoa,
        lat,
        lng,
        ptype_code,
        zip_te,
        math.log(max(hud, 100.0)),
        math.log(max(zcta_income, 10000.0)),
        math.log(max(zcta_rent, 100.0)),
    ]
    return {
        "beds": beds,
        "baths": baths,
        "sqft_log": math.log(max(sqft, 100.0)),
        "year_built": year_built,
        "lot_sqft_log": math.log1p(max(lot, 0.0)),
        "hoa_fee": hoa,
        "lat": lat,
        "lng": lng,
        "ptype_code": ptype_code,
        "zip_te": zip_te,
        "hud_anchor_log": math.log(max(hud, 100.0)),
        "zcta_med_income_log": math.log(max(zcta_income, 10000.0)),
        "zcta_med_rent_log": math.log(max(zcta_rent, 100.0)),
    }


def vector_from_features(feats: dict[str, float], meta: dict) -> list[float]:
    """Emit the feature vector in the ARTIFACT'S declared order.

    The registry is append-only, so new code computes a superset of any
    older artifact's names — emitting in meta["feature_names"] order keeps
    old models servable across deploys. An unknown name is a programmer
    error (a model trained on a feature this code no longer computes), so
    it raises rather than silently zero-filling.
    """
    return [feats[name] for name in meta["feature_names"]]


def build_feature_row(row: dict[str, Any], meta: dict, asof: Any = None) -> list[float]:
    """Back-compat entrypoint: compute + order in one call, using the
    artifact's feature order."""
    return vector_from_features(compute_features(row, meta, asof), meta)


def frame_to_matrix(df, meta: dict):
    """Vectorized version of build_feature_row for a pandas frame with the
    TRAINING_SQL column names. Returns (X ndarray, y ndarray|None, w ndarray)."""
Found 2 new diagnostic issues in 1 file (ctrl+o to expand)

  Ran 1 shell command

6/6 green. Now the preflight in model_store.predict_rows + health flag:

⏺ Update(ml/model_store.py)
Added 10 lines
_zcta_loaded_at: float = 0.0
_ZCTA_TTL_S = 24 * 3600

# Set False by the predict-time preflight when the built vector width does
# not match the loaded booster's expected feature count. Surfaced on
# /healthz so a feature/model mismatch (the 2026-07-08 outage class) is
# observable instead of silently degrading to the v2 fallback.
_feature_match_ok: bool = True


def loaded_version() -> Optional[str]:
    return _loaded_version


def feature_match_ok() -> bool:
    return _feature_match_ok


def refresh(active_version: str, database_url: Optional[str]) -> bool:
    """Ensure artifacts for active_version are loaded. Returns True when the
    store can serve that version."""
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

⏺ Update(ml/model_store.py)
Added 16 lines

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
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

Now surface it in /healthz:

⏺ Update(ml/main.py)
Added 5 lines
        "ok": True,
        "estimator_loaded": estimate_rent_v2 is not None,
        "import_error": _IMPORT_ERR,
        # Feature/model width agreement — False after a mismatch preflight
        # trip (the 2026-07-08 outage class). True until a predict proves
        # otherwise; observable so a bad deploy is caught before the backlog.
        "model_feature_match": model_store.feature_match_ok(),
        "model_loaded_version": model_store.loaded_version(),
    }



Verify all modified Python compiles, then commit P0.1:

  Ran 2 shell commands
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

P0.1 committed. Now P0.2 — the benchmark + calibration + eval history. Start with train_v1.py: extract tree-config constants (discipline) + wall-time alert:

⏺ Update(ml_rent_estimator/train_v1.py)
Added 12 lines, removed 2 lines
_SUBDIR = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "rent_v1"
OUT_DIR = os.path.join(MODEL_DIR, _SUBDIR)

# Tree-config discipline (spec §Tree-config): these are the ONLY knobs the
# P4 capacity A/B is allowed to move, and only if the holdout gate improves.
# Recorded here and in the spec's Sizing notes as the documented baseline.
NUM_LEAVES = 63       # baseline as of 2026-07-08
N_ESTIMATORS = 400    # baseline as of 2026-07-08 (a.k.a. num_boost_round)

# Retrain subprocess ceiling (services/ml/main.py:/ops/run-train passes 1800s).
# Kept in sync here so the wall-time budget warning has the right denominator.
TRAIN_TIMEOUT_SECONDS = 1800

# Native lightgbm.train params (the sklearn wrapper would drag in a
# scikit-learn dependency for nothing).
PARAMS: dict[str, Any] = dict(
    learning_rate=0.06,
    num_leaves=63,
    num_leaves=NUM_LEAVES,
    min_data_in_leaf=40,
    bagging_fraction=0.9,
    bagging_freq=1,

    num_threads=2,
    verbose=-1,
)
NUM_ROUNDS = 400
NUM_ROUNDS = N_ESTIMATORS


def main() -> None:

⏺ Update(ml_rent_estimator/train_v1.py)
Added 15 lines, removed 1 line
    with open(os.path.join(OUT_DIR, "metadata.json"), "w") as f:
        json.dump(meta_out, f)

    print(json.dumps({"done": True, "wall_s": round(time.time() - t0), **quick}), flush=True)
    wall = time.time() - t0
    # Early signal before the /ops/run-train subprocess timeout actually
    # trips: warn at 60% of the ceiling so tree size / row count can be
    # reviewed while the pipeline still works.
    if wall > 0.6 * TRAIN_TIMEOUT_SECONDS:
        print(
            f"WARNING training wall time {wall:.0f}s approaching timeout ceiling "
            f"({TRAIN_TIMEOUT_SECONDS}s) — review num_leaves/n_estimators or prune "
            f"rental_listings",
            flush=True,
        )
    print(
        json.dumps({"done": True, "wall_s": round(wall), "train_wall_seconds": round(wall), **quick}),
        flush=True,
    )


if __name__ == "__main__":
Found 3 new diagnostic issues in 1 file (ctrl+o to expand)

Now the core: eval_v1.py — HUD-by-name, high-variance ZIP slice, size-aware Spearman (numpy-only, no scipy dep), calibration fields, importances, and eval_report.json persistence. Add helpers first:

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 98 lines
# 'rent_v1_staging' before promotion).
_SUBDIR = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "rent_v1"
OUT_DIR = os.path.join(MODEL_DIR, _SUBDIR)
LIVE_DIR = os.path.join(MODEL_DIR, "rent_v1")  # the incumbent, for the gate denominator
HISTORY_PATH = os.path.join(MODEL_DIR, "eval_history.jsonl")
V0_SAMPLE = 2000

# Allowed high-variance-ZIP MAE regression vs the incumbent (1.02 = +2%).
HIGHVAR_REGRESSION_MAX = 1.02
# Empirical p10-p90 coverage band. Warning-only until P3, hard gate after.
BAND_COVERAGE_MIN = 0.78
BAND_COVERAGE_MAX = 0.84


def mae(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - actual)))


def _spearman(a: np.ndarray, b: np.ndarray) -> float:
    """Rank correlation without a scipy dependency (Pearson on ranks). Ties
    are broken by order — fine for a directional within-ZIP quality signal."""
    if len(a) < 3:
        return float("nan")
    ra = np.argsort(np.argsort(a)).astype(float)
    rb = np.argsort(np.argsort(b)).astype(float)
    ra -= ra.mean()
    rb -= rb.mean()
    denom = math.sqrt(float((ra**2).sum()) * float((rb**2).sum()))
    return float((ra * rb).sum() / denom) if denom > 0 else float("nan")


def highvar_slice(hold_df, pred_p50: np.ndarray, actual: np.ndarray) -> dict:
    """Metrics on the top-decile most-price-dispersed ZIPs (>=30 holdout
    rows) — the split-ZIP neighborhoods (e.g. 90004) this whole model effort
    targets. within_zip_spearman is a sqrt(n)-weighted mean so a 5-row ZIP
    does not count the same as a 500-row ZIP."""
    df = hold_df.assign(_pred=pred_p50, _actual=actual)
    g = df.groupby("zip")["_actual"].agg(
        n="count", v=lambda s: float(np.var(np.log(np.clip(s.to_numpy(dtype=float), 1.0, None))))
    )
    eligible = g[g["n"] >= 30]
    if eligible.empty:
        return {"highvar_zip_count": 0, "highvar_zip_mae": None, "within_zip_spearman": None}
    k = max(1, len(eligible) // 10)
    hv = set(eligible.nlargest(k, "v").index)
    m = df[df["zip"].isin(hv)]
    rhos, weights = [], []
    for _z, x in m.groupby("zip"):
        if len(x) >= 5:
            rho = _spearman(x["_pred"].to_numpy(dtype=float), x["_actual"].to_numpy(dtype=float))
            if rho == rho:  # not NaN
                rhos.append(rho)
                weights.append(math.sqrt(len(x)))
    wspear = float(np.average(rhos, weights=weights)) if rhos else None
    return {
        "highvar_zip_count": len(hv),
        "highvar_zip_mae": float(np.mean(np.abs(m["_pred"] - m["_actual"]))),
        "within_zip_spearman": wspear,
    }


def load_incumbent_report() -> Optional[dict]:
    """The live model's persisted eval report — the gate denominator. Absent
    on first run (bootstrap): the highvar non-regression check is skipped."""
    path = os.path.join(LIVE_DIR, "eval_report.json")
    if OUT_DIR == LIVE_DIR or not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def rolling_min_highvar(days: int = 30) -> Optional[float]:
    """Min highvar_zip_mae over the last `days` of promoted models, from the
    rolling eval_history.jsonl. Available for a stricter ratchet; the P0 gate
    uses the latest-promote denominator (load_incumbent_report) instead."""
    if not os.path.exists(HISTORY_PATH):
        return None
    import datetime as _dt

    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=days)
    best: Optional[float] = None
    try:
        with open(HISTORY_PATH) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                ts = rec.get("promoted_at") or rec.get("trained_at")
                hv = (rec.get("highvar") or {}).get("highvar_zip_mae")
                if hv is None:
                    continue
                if ts:
                    try:
                        when = _dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        if when < cutoff:
                            continue
                    except ValueError:
                        pass
                best = hv if best is None else min(best, hv)
    except (OSError, ValueError):
        return None
    return best


def main() -> None:
    import lightgbm as lgb

Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

Need math + Optional imports in eval_v1:

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 2 lines

import hashlib
import json
import math
import os
import sys
from typing import Optional

import numpy as np
import pandas as pd

Now wire the new metrics + gate + persistence into main():

  Read 1 file
Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

The remaining diagnostics are pre-existing pandas typing quibbles (runtime-safe). Now replace the metrics/gate block with HUD-by-name + highvar + calibration + importances + gate:

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 21 lines, removed 3 lines

    pred = {q: np.exp(np.asarray(b.predict(X), dtype=float)) for q, b in boosters.items()}

    # HUD baseline: the hud_anchor feature IS log(safmr-with-fallback) — column 10.
    hud_pred = np.exp(X[:, 10])
    # HUD baseline: the hud_anchor feature IS log(safmr-with-fallback).
    # Look it up by NAME — hardcoding the column index breaks silently the
    # moment a feature is appended before it (append-only registry or not).
    hud_idx = meta["feature_names"].index("hud_anchor_log")
    hud_pred = np.exp(X[:, hud_idx])

    coverage = float(np.mean((actual >= pred["p10"]) & (actual <= pred["p90"])))
    overall = {
        "rows": int(len(hold)),
        "v1_mae": mae(pred["p50"], actual),
        "v1_mape": float(np.mean(np.abs(pred["p50"] - actual) / actual)),
        "hud_mae": mae(hud_pred, actual),
        "band_coverage": float(np.mean((actual >= pred["p10"]) & (actual <= pred["p90"]))),
        "band_coverage": coverage,  # kept for back-compat
        "band_coverage_p10_p90": coverage,
        "band_undercoverage": float(np.mean(actual < pred["p10"])),
        "band_overcoverage": float(np.mean(actual > pred["p90"])),
    }

    # Split-ZIP benchmark — the metric this whole model effort is judged on.
    highvar = highvar_slice(hold, pred["p50"], actual)

    # Top-20 gain importances (debugging priors + density features).
    gains = boosters["p50"].feature_importance(importance_type="gain")
    importances = sorted(
        ({"feature": n, "gain": float(g)} for n, g in zip(meta["feature_names"], gains)),
        key=lambda d: d["gain"],
        reverse=True,
    )[:20]

    # Per-state (top 15 by rows).
    hold = hold.assign(_v1=pred["p50"], _hud=hud_pred, _actual=actual)
    top_states = hold["state"].value_counts().head(15).index.tolist()

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 44 lines, removed 2 lines
        v0_metrics = {"error": str(exc)[:200]}

    gate_ratio = overall["v1_mae"] / overall["hud_mae"] if overall["hud_mae"] else 1.0
    gate_pass = gate_ratio <= 0.85 and wins >= 10

    # Highvar non-regression vs the incumbent (bootstrap-safe: skipped when
    # there is no prior report, e.g. the P0 baseline run). The stronger
    # improvement gate (>=5% at P1) layers on top of this in that phase.
    incumbent = load_incumbent_report()
    highvar_ok = True
    highvar_note = None
    inc_hv = ((incumbent or {}).get("highvar") or {}).get("highvar_zip_mae")
    cand_hv = highvar.get("highvar_zip_mae")
    if inc_hv is not None and cand_hv is not None:
        highvar_ok = cand_hv <= inc_hv * HIGHVAR_REGRESSION_MAX
        highvar_note = f"cand={cand_hv:.1f} vs incumbent={inc_hv:.1f} (max x{HIGHVAR_REGRESSION_MAX})"
    else:
        highvar_note = "no incumbent report — highvar gate skipped (bootstrap)"

    # Band calibration: warning-only at P0-P2, becomes a hard gate at P3.
    band_ok = BAND_COVERAGE_MIN <= coverage <= BAND_COVERAGE_MAX
    if not band_ok:
        print(
            f"WARNING band coverage {coverage:.3f} outside [{BAND_COVERAGE_MIN},"
            f"{BAND_COVERAGE_MAX}] — inspect quantile alphas before P3 hard gate",
            flush=True,
        )

    gate_pass = gate_ratio <= 0.85 and wins >= 10 and highvar_ok
    metrics = {
        "overall": overall,
        "highvar": highvar,
        "importances_top20": importances,
        "per_state": per_state,
        "state_wins_vs_hud": wins,
        "gate": {"ratio": gate_ratio, "wins": wins, "pass": gate_pass},
        "gate": {
            "ratio": gate_ratio,
            "wins": wins,
            "highvar_ok": highvar_ok,
            "highvar_note": highvar_note,
            "band_coverage_ok": band_ok,
            "pass": gate_pass,
        },
        "v0_sample": v0_metrics,
        "trained_at": meta.get("trained_at"),
        "train_rows": meta.get("train_rows"),
    }

    # Persist the report next to the artifact so the NEXT retrain has a gate
    # denominator, and so the promote step (main.py) can append it to the
    # rolling eval_history.jsonl.
    try:
        with open(os.path.join(OUT_DIR, "eval_report.json"), "w") as f:
            json.dump(metrics, f)
    except OSError as exc:
        print(f"WARNING could not write eval_report.json: {exc}", flush=True)

    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

Compile-check eval_v1, then add the eval_history.jsonl append to the promote path in main.py:

  Ran 1 shell command

⏺ Update(ml/main.py)
Added 15 lines
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
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

Add unit tests for the numpy-only eval helpers (_spearman, highvar_slice):

⏺ Write(ml_rent_estimator/test_eval.py)
Wrote 54 lines to ml_rent_estimator/test_eval.py
""Unit tests for the eval helpers that don't need lightgbm.

   cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_eval.py -v
""
mport numpy as np
mport pandas as pd

rom ml_rent_estimator.eval_v1 import _spearman, highvar_slice

… +44 lines

  Ran 1 shell command

eval_v1 imports psycopg2 at module top, blocking helper tests. Make it lazy (only main() needs it) — also cleaner:

⏺ Update(ml_rent_estimator/eval_v1.py)
Removed 1 line

import numpy as np
import pandas as pd
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml_rent_estimator.dataset import TRAINING_SQL, frame_to_matrix

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 1 line

def main() -> None:
    import lightgbm as lgb
    import psycopg2

    with open(os.path.join(OUT_DIR, "metadata.json")) as f:
        meta = json.load(f)

  Ran 1 shell command
Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

11/11 green. Commit P0.2, then deploy ML and run the baseline-freeze retrain:

  Ran 2 shell commands

ML built. Recreate it, verify the new /healthz surface, then pause the rent worker and run the baseline-freeze retrain:

  Ran 1 shell command

model_feature_match: true live, predict healthy. Now the baseline-freeze retrain (pause worker for memory, run in background):

  Ran 1 shell command

Retrain running. While it trains, start P1 plumbing. First, the pattern for the keyset backfill — read the existing tract backfill:

  Read 1 file

P1.1 — write the runner migration (column+index) and the out-of-band keyset backfill procedure for rental_listings (uses its location geometry):

⏺ Write(~/Code/OnePercentRealEstate/infrastructure/migrations/2026_07_09_rental_census_tract.sql)
Wrote 6 lines to ../infrastructure/migrations/2026_07_09_rental_census_tract.sql
-- rental_listings.census_tract — the serving/training join key for the
-- hyperlocal tract features (rent model v2 P1). Column + partial index only;
-- the backfill itself is out-of-band (CONCURRENTLY-free but long-running).
ALTER TABLE rental_listings ADD COLUMN IF NOT EXISTS census_tract TEXT;
CREATE INDEX IF NOT EXISTS idx_rental_census_tract
  ON rental_listings(census_tract) WHERE census_tract IS NOT NULL;

⏺ Write(~/Code/OnePercentRealEstate/infrastructure/migrations/out-of-band/2026_07_09_backfill_rental_census_tract.sql)
Wrote 53 lines to ../infrastructure/migrations/out-of-band/2026_07_09_backfill_rental_census_tract.sql
-- OUT-OF-BAND: keyset-batched backfill of census_tract on rental_listings.
--
-- Mirror of 2026_07_07_backfill_census_tract.sql but for rental_listings,
-- which carries a `location` geometry (SRID 4326) so we join on that rather
-- than rebuilding a point from lat/lng. Marker: census_tract IS NULL AND
-- location IS NOT NULL. Idempotent, resumable, SKIP LOCKED so it never
-- deadlocks the live rental scrape upserts. Does NOT touch updated_at.
--
-- Run after 2026_07_09_rental_census_tract.sql (column + index) is applied:
--   docker exec infrastructure-postgres-1 psql -U postgres -d postgres \
… +43 lines

Check the baseline retrain progress:

  Ran 1 shell command

Training progressing (p10/p50 written). Continue P1.2 — check ML requirements, then add h3, the h3_market_stats migration, and market_stats.py:

  Read 1 file

⏺ Update(ml/requirements.txt)
Added 3 lines
# Wave 2: rent model v1 (training + quantile inference). Needs libgomp1 at
# runtime — provided transitively by build-essential in the Dockerfile.
lightgbm==4.5.0
# rent model v2 (P1): H3 hexes for the hyperlocal market-stats surface +
# hex TE cascade. Pure wheel, ~1 MB, no Postgres extension required.
h3==4.1.0

⏺ Background command "Baseline-freeze retrain in background" completed (exit code 0)

Baseline retrain done. Read the result — verify the new report shape (highvar, calibration) and that eval_history got its first entry:

  Ran 1 shell command

P0 complete — baseline frozen. Overall MAE $487.89, and critically highvar_zip_mae = **$1072.78** (2.2× overall — the split-ZIP weakness quantified; P1 must cut this ≥5% → ≤$1019). within_zip_spearman 0.886. eval_history seeded. Restart the worker, then finish P1.2 (h3 table + refresh):

  Ran 1 shell command

⏺ Write(~/Code/OnePercentRealEstate/infrastructure/migrations/2026_07_09_h3_market_stats.sql)
Wrote 18 lines to ../infrastructure/migrations/2026_07_09_h3_market_stats.sql
-- h3_market_stats — precomputed local rent/sold $/sqft surface at H3 res-8
-- (~0.7 km² hexes), the "how does this compare with prices nearby" signal
-- for rent model v2 P1. Refreshed nightly by services/ml_rent_estimator/
-- market_stats.py (Python-side H3; NO Postgres h3 extension is installed).
--
-- stat_month = the month the stats DESCRIBE (data drawn from that month).
-- Leakage rule enforced by the reader: training joins the month strictly
-- before a row's listing_date; serving uses the latest complete month.
CREATE TABLE IF NOT EXISTS h3_market_stats (
  h3_8         TEXT NOT NULL,
… +8 lines

Now market_stats.py — the Python-side H3 refresh (no PG extension):

⏺ Write(ml_rent_estimator/market_stats.py)
Wrote 194 lines to ml_rent_estimator/market_stats.py
"""Nightly refresh of the hyperlocal market-stats surface (rent model v2 P1)
and the durable address rent memory (P2).

H3 indexing is done in Python (the prod Postgres has no h3 extension and we
will not add one for this). Called by services/ml/main.py:/ops/refresh-market-stats,
which the ml-scheduler triggers nightly.

Two maintained artifacts, one pass:
  - h3_market_stats: median rent/sold $/sqft per (H3 res-8 hex, month).
  - address_rent_history (P2): latest observed rent per normalized address.
… +184 lines
Found 5 new diagnostic issues in 1 file (ctrl+o to expand)

Add the refresh endpoint to main.py:

⏺ Update(ml/main.py)
Added 10 lines
    return OpResponse(ok=ok, lines=lines, exit_code=exit_code, alert=alert)


@app.post("/ops/refresh-market-stats", response_model=OpResponse)
async def refresh_market_stats() -> OpResponse:
    """Rebuild the H3 market-stats surface + address rent memory (rent v2 P1/P2).
    Triggered nightly by the ml-scheduler."""
    ok, lines, code = await _run_subprocess(
        ["python", "-m", "ml_rent_estimator.market_stats"], timeout_s=600.0
    )
    return OpResponse(ok=ok, lines=lines, exit_code=code, alert=not ok)


@app.post("/ops/run-train", response_model=OpResponse)
async def run_train() -> OpResponse:
    """Wave 2 nightly retrain: train into a staging dir, run the eval gate
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

Add --geo tract mode. Read the ACS ZCTA loader to extend it:

  Read 1 file

I'll add tract support cleanly. First the tract_demographics migration, then extend the loader with --geo tract + --year:

⏺ Write(~/Code/OnePercentRealEstate/infrastructure/migrations/2026_07_09_tract_demographics.sql)
Wrote 12 lines to ../infrastructure/migrations/2026_07_09_tract_demographics.sql
-- tract-level ACS demographics — the fine-grained income anchor for rent
-- model v2 P1 (tract_med_income_log) and the 5-yr growth features (P3).
-- geoid = state(2)+county(3)+tract(6) = 11 digits, matching census_tracts.geoid.
CREATE TABLE IF NOT EXISTS tract_demographics (
  geoid             TEXT NOT NULL,
  acs_year          INT  NOT NULL,
  median_hh_income  NUMERIC,
  median_gross_rent NUMERIC,
  median_home_value NUMERIC,
  population        NUMERIC,
… +2 lines

⏺ Update(ml_rent_estimator/load_acs_zcta.py)
Added 88 lines
    return rows


# State FIPS codes (50 states + DC). Tract queries require an `in=state:`
# scope — the API rejects a nationwide `for=tract:*`.
STATE_FIPS = [f"{i:02d}" for i in range(1, 57)]
# 03, 07, 14, 43, 52 are unassigned FIPS — the API 204s/errors, we skip.

TRACT_VARIABLES = [
    "B19013_001E",  # median household income
    "B25064_001E",  # median gross rent
    "B25077_001E",  # median home value
    "B01003_001E",  # population
]


def fetch_tracts(year: int, api_key: str) -> list[dict[str, Any]]:
    """Fetch ACS 5-year tract data for every state. geoid = state+county+tract.
    Returns dicts: geoid, acs_year, income, rent, value, population."""
    rows: list[dict[str, Any]] = []
    for fips in STATE_FIPS:
        params = "?get=" + ",".join(TRACT_VARIABLES) + f"&for=tract:*&in=state:{fips}"
        if api_key:
            params += f"&key={api_key}"
        url = f"https://api.census.gov/data/{year}/acs/acs5{params}"
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=90) as resp:
                if resp.status == 204:
                    continue
                body = resp.read().decode()
            if not body.strip() or body.lstrip().startswith("<"):
                continue
            raw = json.loads(body)
        except Exception as exc:  # unassigned FIPS / transient — skip, keep going
            print(f"  state {fips} {year}: {str(exc)[:80]}", file=sys.stderr)
            continue
        header = raw[0]
        si, ci, ti = (header.index(k) for k in ("state", "county", "tract"))
        for row in raw[1:]:
            geoid = f"{row[si]}{row[ci]}{row[ti]}"
            if len(geoid) != 11:
                continue
            entry: dict[str, Any] = {"geoid": geoid, "acs_year": year}
            for i, var in enumerate(TRACT_VARIABLES):
                entry[var] = _null_sentinels(row[i])
            rows.append(entry)
    print(f"  fetched {len(rows)} tract rows for {year}", file=sys.stderr)
    return rows


def _upsert_tracts(rows: list[dict[str, Any]]) -> None:
    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO tract_demographics
                       (geoid, acs_year, median_hh_income, median_gross_rent,
                        median_home_value, population)
                   VALUES %s
                   ON CONFLICT (geoid, acs_year) DO UPDATE SET
                       median_hh_income  = COALESCE(EXCLUDED.median_hh_income, tract_demographics.median_hh_income),
                       median_gross_rent = COALESCE(EXCLUDED.median_gross_rent, tract_demographics.median_gross_rent),
                       median_home_value = COALESCE(EXCLUDED.median_home_value, tract_demographics.median_home_value),
                       population        = COALESCE(EXCLUDED.population, tract_demographics.population)""",
                [
                    (r["geoid"], r["acs_year"], r["B19013_001E"], r["B25064_001E"],
                     r["B25077_001E"], r["B01003_001E"])
                    for r in rows
                ],
                page_size=5000,
            )
        conn.commit()
        print(f"upserted {len(rows)} tract rows", file=sys.stderr)
    finally:
        conn.close()


def _arg_year(default_years: tuple[int, ...]) -> tuple[int, ...]:
    """--year YYYY overrides the default year list (P3 loads 2019)."""
    if "--year" in sys.argv:
        i = sys.argv.index("--year")
        if i + 1 < len(sys.argv):
            return (int(sys.argv[i + 1]),)
    return default_years


def fetch_fallback_csv() -> list[dict[str, Any]]:
    """Fetch ACS data from the MichaelMinn pre-processed CSV (no key needed)."""
    url = "https://michaelminn.net/tutorials/data/2019-2023-acs-zcta.csv"
Found 6 new diagnostic issues in 1 file (ctrl+o to expand)

Now wire --geo tract / --year into the loader's main():

⏺ Update(ml_rent_estimator/load_acs_zcta.py)
Added 15 lines, removed 1 line
    api_key = os.environ.get("CENSUS_API_KEY")
    rows: list[dict[str, Any]] = []

    # Tract mode (rent v2 P1/P3): per-state ACS tract load → tract_demographics.
    if "--geo" in sys.argv and "tract" in sys.argv:
        years = _arg_year((2023,))
        trows: list[dict[str, Any]] = []
        for year in years:
            trows = fetch_tracts(year, api_key or "")
            if trows:
                _upsert_tracts(trows)
        if not trows:
            print("ERROR: no tract rows fetched", file=sys.stderr)
            sys.exit(1)
        return

    zcta_years = _arg_year((2024, 2023))
    # Tier 1: Try API with key (if available)
    if api_key:
        for year in (2024, 2023):
        for year in zcta_years:
            try:
                rows = fetch(year, api_key)
                if rows:
Found 4 new diagnostic issues in 1 file (ctrl+o to expand)

  Read 1 file

⏺ Update(ml_rent_estimator/load_acs_zcta.py)
Added 1 line, removed 1 line

    # Tier 2: Try API without key (Census free tier: 500 req/day/IP)
    if not rows:
        for year in (2024, 2023):
        for year in zcta_years:
            try:
                rows = fetch(year, "")
                if rows:
Found 4 new diagnostic issues in 1 file (ctrl+o to expand)

Compile-check all P1 Python, then commit the P1 code before the DB operations:

  Ran 2 shell commands

Rsync, then apply the three migrations (idempotent) on the server:

  Ran 1 shell command

Migrations applied. Load the rental-tract backfill procedure and run it in the background (~380K rows):

  Ran 2 shell commands

Backfill running. Rebuild ML to bake in h3 + the P1 code (tract loader, market_stats):

  Ran 2 shell commands

h3 4.1.0 live. Load tract ACS 2023 (loops 56 states, ~80K rows) in the background:

  Ran 1 shell command

Both backfills running in the background. Now the core P1.4 feature work in dataset.py. Installing h3 locally first so I can TDD the cascade:

  Ran 1 shell command

⏺ Background command "Load ACS 2023 tract demographics in background" completed (exit code 0)

Tract ACS load finished. Check results + backfill progress, and set up a scratch venv for local h3 testing:

  Ran 1 shell command

Both data loads done: tract_demographics 84,400 (✓≥80K), rentals tagged 99.95% (✓≥97%). Now run the market-stats refresh (P1.2 acceptance) and build the local venv:

  Ran 2 shell commands

venv ready (h3 4.5.0), market-stats refresh running. Now the core P1.4 — the TE cascade + local surface + density features in dataset.py. First append the 8 features + update the docstring:

⏺ Update(ml_rent_estimator/dataset.py)
Added 14 lines
    "hud_anchor_log",
    "zcta_med_income_log",
    "zcta_med_rent_log",
    # --- rent model v2 P1: hyperlocal location (append-only) ---
    "tract_te",             # shrinkage TE at census-tract level
    "h3_te",                # shrinkage TE at the finest available H3 hex
    "local_rent_psf_log",   # local rental $/sqft surface (H3 res-8 + ring-1)
    "local_sold_psf_log",   # local sold $/sqft surface (H3 res-8 + ring-1)
    "local_obs_log",        # log1p obs behind the finest TE level (trust)
    "tract_med_income_log", # ACS tract median household income
    "h3_8_obs_log",         # density at res-8 (learn when the coarse hex is thin)
    "h3_9_obs_log",         # density at res-9 (learn when the fine hex is trustworthy)
]

# Missing-value sentinels (documented so train and serve stay identical).
# LightGBM splits on these cleanly; they are NOT plausible real values.
_SENTINEL_PSF = 0.1        # log(0.1) — "no local surface"
_SENTINEL_LOG0 = 0.0       # absent log features

TRAINING_SQL = """
SELECT DISTINCT ON (r.address, r.listing_date)
       ('x' || substr(md5(r.address), 1, 8))::bit(32)::int % 10 AS split_bucket,

⏺ Background command "Run market-stats refresh to populate h3_market_stats" completed (exit code 0)
Found 6 new diagnostic issues in 1 file (ctrl+o to expand)

Market-stats refresh done. Check the hex count (P1.2 acceptance ≥50K), then add the cascade + surface helpers:

  Ran 1 shell command
Found 7 new diagnostic issues in 1 file (ctrl+o to expand)

All P1 data in place: h3_market_stats 90,413 hexes (✓≥50K), rentals 99.95% tagged, tracts 84,400. (The addr_error is expected — that table is P2.) Now add the cascade + surface helpers to dataset.py:

⏺ Update(ml_rent_estimator/dataset.py)
Added 85 lines
    return float(meta.get(global_key, hardcoded))


# --- rent model v2 P1 helpers: hyperlocal location ---

def _h3_cells(lat: float, lng: float) -> tuple[Optional[str], Optional[str]]:
    """(h3_res8, h3_res9) for a point, or (None, None) if unavailable. h3 is
    a hard dep of the ML image; guarded so unit envs without it degrade to
    the coarser TE levels rather than crashing."""
    if lat is None or lng is None or lat != lat or lng != lng or (lat == 0.0 and lng == 0.0):
        return None, None
    try:
        import h3
        return h3.latlng_to_cell(float(lat), float(lng), 8), h3.latlng_to_cell(float(lat), float(lng), 9)
    except Exception:
        return None, None


def _shrink(n: float, logsum: float, parent: float, prior: float) -> float:
    """Empirical-Bayes shrinkage of a level's mean toward its parent:
    (sum(log rent) + prior*parent) / (n + prior)."""
    return (logsum + prior * parent) / (n + prior)


def _te_cascade(zip_te: float, tract_key: str, h3_8: Optional[str], h3_9: Optional[str],
                te_stats: dict, global_mean_log: float) -> dict[str, float]:
    """Hierarchical location TE: global -> zip_te (incumbent) -> tract ->
    h3_8 -> h3_9, each level shrinking toward the previous. A missing level
    just inherits its parent. Priors 20/15/10 favor the coarser (more
    populated) level until the fine cell has enough observations. Returns
    tract_te, h3_te (finest), and the per-level observation counts the model
    uses to learn how far to trust the fine cell."""
    t_stats = te_stats.get("tract", {})
    e_stats = te_stats.get("h3_8", {})
    f_stats = te_stats.get("h3_9", {})

    t_n, t_ls = t_stats.get(tract_key, (0.0, 0.0)) if tract_key else (0.0, 0.0)
    tract_te = _shrink(t_n, t_ls, zip_te, 20.0) if t_n else zip_te

    e_n, e_ls = e_stats.get(h3_8, (0.0, 0.0)) if h3_8 else (0.0, 0.0)
    h8_te = _shrink(e_n, e_ls, tract_te, 15.0) if e_n else tract_te

    f_n, f_ls = f_stats.get(h3_9, (0.0, 0.0)) if h3_9 else (0.0, 0.0)
    h9_te = _shrink(f_n, f_ls, h8_te, 10.0) if f_n else h8_te

    return {
        "tract_te": tract_te,
        "h3_te": h9_te,
        "local_obs": float(f_n or e_n or t_n or 0.0),
        "h3_8_obs": float(e_n),
        "h3_9_obs": float(f_n),
    }


def _local_surface(h3_8: Optional[str], local_by_hex: dict, meta: dict) -> tuple[float, float]:
    """Local rent/sold $/sqft for a hex: the hex's own medians, else the
    mean over its res-8 ring-1 neighbors, else the global median. local_by_hex
    maps h3_8 -> [rent_psf, sold_psf, n_rent, n_sold]."""
    g_rent = float(meta.get("global_rent_psf", 2.0))
    g_sold = float(meta.get("global_sold_psf", 250.0))
    if not h3_8 or not local_by_hex:
        return g_rent, g_sold
    hit = local_by_hex.get(h3_8)
    if hit and hit[0] is not None and hit[1] is not None:
        return float(hit[0]), float(hit[1])

    # Ring-1 neighbor mean for whichever surface the hex itself lacks.
    rent_vals, sold_vals = [], []
    if hit and hit[0] is not None:
        rent_vals.append(float(hit[0]))
    if hit and hit[1] is not None:
        sold_vals.append(float(hit[1]))
    try:
        import h3
        for nb in h3.grid_disk(h3_8, 1):
            nv = local_by_hex.get(nb)
            if nv:
                if nv[0] is not None:
                    rent_vals.append(float(nv[0]))
                if nv[1] is not None:
                    sold_vals.append(float(nv[1]))
    except Exception:
        pass
    rent_psf = sum(rent_vals) / len(rent_vals) if rent_vals else g_rent
    sold_psf = sum(sold_vals) / len(sold_vals) if sold_vals else g_sold
    return rent_psf, sold_psf


def compute_features(row: dict[str, Any], meta: dict, asof: Any = None) -> dict[str, float]:
    """Compute EVERY registered feature for a row, keyed by feature name.

Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

Now emit the 8 features from compute_features:

⏺ Update(ml_rent_estimator/dataset.py)
Added 25 lines
        meta, "zcta_rent_global_median", 1000.0,
    )

    # --- P1 hyperlocal ---
    # h3 cells: prefer caller-precomputed (frame_to_matrix vectorizes them
    # for training speed); otherwise derive from lat/lng (serving path).
    h3_8 = row.get("h3_8") or None
    h3_9 = row.get("h3_9") or None
    if h3_8 is None and h3_9 is None:
        h3_8, h3_9 = _h3_cells(lat, lng)
    tract_key = str(row.get("census_tract") or "")

    cas = _te_cascade(zip_te, tract_key, h3_8, h3_9, meta.get("te_stats", {}), meta["global_mean_log"])
    rent_psf, sold_psf = _local_surface(h3_8, meta.get("local_by_hex", {}), meta)

    tract_income = meta.get("tract_income", {}).get(tract_key)
    if not tract_income or tract_income != tract_income:
        tract_income = zcta_income  # fall back to the (coarser) ZCTA income

    return {
        "beds": beds,
        "baths": baths,

        "hud_anchor_log": math.log(max(hud, 100.0)),
        "zcta_med_income_log": math.log(max(zcta_income, 10000.0)),
        "zcta_med_rent_log": math.log(max(zcta_rent, 100.0)),
        # --- P1 hyperlocal ---
        "tract_te": cas["tract_te"],
        "h3_te": cas["h3_te"],
        "local_rent_psf_log": math.log(max(rent_psf, _SENTINEL_PSF)),
        "local_sold_psf_log": math.log(max(sold_psf, 1.0)),
        "local_obs_log": math.log1p(cas["local_obs"]),
        "tract_med_income_log": math.log(max(float(tract_income), 10000.0)),
        "h3_8_obs_log": math.log1p(cas["h3_8_obs"]),
        "h3_9_obs_log": math.log1p(cas["h3_9_obs"]),
    }


Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

Remove the unused sentinel constant, then extend fit_encoders to bake the P1 lookup dicts:

⏺ Update(ml_rent_estimator/dataset.py)
Added 4 lines, removed 4 lines
    "h3_9_obs_log",         # density at res-9 (learn when the fine hex is trustworthy)
]

# Missing-value sentinels (documented so train and serve stay identical).
# LightGBM splits on these cleanly; they are NOT plausible real values.
_SENTINEL_PSF = 0.1        # log(0.1) — "no local surface"
_SENTINEL_LOG0 = 0.0       # absent log features
# Missing-value floor for the local psf surface (log(0.1)); not a plausible
# real $/sqft, so LightGBM can split "no surface" cleanly. Property-history
# sentinels (-1 / 0 / 1) arrive with those features in P2.
_SENTINEL_PSF = 0.1

TRAINING_SQL = """
SELECT DISTINCT ON (r.address, r.listing_date)
Found 6 new diagnostic issues in 1 file (ctrl+o to expand)

Extend fit_encoders for the P1 dicts + add an h3-column helper + census_tract to TRAINING_SQL. First the SQL:

⏺ Update(ml_rent_estimator/dataset.py)
Added 1 line
       upper(coalesce(r.property_type, 'UNKNOWN')) AS ptype,
       coalesce(r.zip_code, '') AS zip,
       upper(coalesce(r.state, '')) AS state,
       coalesce(r.census_tract, '') AS census_tract,
       r.listing_date,
        h.safmr::float          AS hud_safmr,
        z.median_hh_income::float  AS zcta_med_income,
Found 8 new diagnostic issues in 1 file (ctrl+o to expand)

Now extend fit_encoders with the P1 stats + add the add_h3_columns helper:

⏺ Update(ml_rent_estimator/dataset.py)
Added 44 lines, removed 2 lines
"""


def fit_encoders(train_df) -> dict:
def add_h3_columns(df):
    """Add h3_8 / h3_9 string columns to a training frame (computed once,
    reused by fit_encoders + frame_to_matrix). Rows without geometry get
    empty strings."""
    import h3

    def cells(row):
        lat, lng = row["lat"], row["lng"]
        if lat is None or lng is None or lat != lat or lng != lng:
            return ("", "")
        try:
            return (h3.latlng_to_cell(float(lat), float(lng), 8),
                    h3.latlng_to_cell(float(lat), float(lng), 9))
        except (ValueError, TypeError):
            return ("", "")

    pairs = df.apply(cells, axis=1)
    df["h3_8"] = [p[0] for p in pairs]
    df["h3_9"] = [p[1] for p in pairs]
    return df


def _te_raw_stats(train_df, key_col: str) -> dict:
    """{key: [count, sum(log rent)]} for a grouping column, train fold only.
    The cascade shrinks these raw sufficient statistics per level."""
    import numpy as np

    sub = train_df[train_df[key_col].astype(str) != ""]
    if sub.empty:
        return {}
    g = sub.groupby(key_col)["rent"].agg(
        n="count", logsum=lambda s: float(np.log(s.to_numpy(dtype=float)).sum())
    )
    return {str(k): [float(r.n), float(r.logsum)] for k, r in g.iterrows() if str(k)}


def fit_encoders(train_df, market_stats: Optional[dict] = None,
                 tract_income: Optional[dict] = None) -> dict:
    """Fit all encoders on the TRAIN frame only. Returns the metadata dict
    that predict-time feature building consumes."""
    that predict-time feature building consumes.

    market_stats: {h3_8: [rent_psf, sold_psf, n_rent, n_sold]} (collapsed
      across months by the caller). tract_income: {geoid: median_hh_income}.
    Both are baked into meta so serving reconstructs identical features.
    """
    import numpy as np

    global_mean_log = float(np.log(train_df["rent"]).mean())
Found 6 new diagnostic issues in 1 file (ctrl+o to expand)

Now bake the P1 dicts into fit_encoders's return. View the current return block:

  Read 1 file
Found 6 new diagnostic issues in 1 file (ctrl+o to expand)

⏺ Update(ml_rent_estimator/dataset.py)
Added 21 lines
        .items()
    }

    # --- P1 hyperlocal encoders (train fold only) ---
    # Raw TE sufficient statistics per level (needs h3_8/h3_9 columns, which
    # add_h3_columns() supplies before this call).
    te_stats = {
        "tract": _te_raw_stats(train_df, "census_tract") if "census_tract" in train_df else {},
        "h3_8": _te_raw_stats(train_df, "h3_8") if "h3_8" in train_df else {},
        "h3_9": _te_raw_stats(train_df, "h3_9") if "h3_9" in train_df else {},
    }

    local_by_hex = market_stats or {}
    rent_vals = [v[0] for v in local_by_hex.values() if v and v[0] is not None]
    sold_vals = [v[1] for v in local_by_hex.values() if v and v[1] is not None]
    global_rent_psf = float(np.median(rent_vals)) if rent_vals else 2.0
    global_sold_psf = float(np.median(sold_vals)) if sold_vals else 250.0

    return {
        "feature_names": FEATURE_NAMES,
        "global_mean_log": global_mean_log,

        "sqft_median_by_beds": sqft_median_by_beds,
        "zcta_income_global_median": zcta_income_global_median,
        "zcta_rent_global_median": zcta_rent_global_median,
        # P1 hyperlocal (large — train_v1 splits these into a sidecar file):
        "te_stats": te_stats,
        "local_by_hex": local_by_hex,
        "tract_income": tract_income or {},
        "global_rent_psf": global_rent_psf,
        "global_sold_psf": global_sold_psf,
    }


Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

Add P1 unit tests (cascade, local surface, density) and run with the h3-enabled venv:

⏺ Update(ml_rent_estimator/test_dataset.py)
Added 71 lines
    # zip_te falls back to global_mean_log for an unknown zip
    idx = FEATURE_NAMES.index("zip_te")
    assert v[idx] == pytest.approx(7.5)


# --- P1 hyperlocal ---

from ml_rent_estimator.dataset import _te_cascade, _local_surface  # noqa: E402


def test_cascade_falls_back_to_zip_te_when_all_levels_empty():
    cas = _te_cascade(zip_te=8.1, tract_key="", h3_8=None, h3_9=None, te_stats={}, global_mean_log=7.5)
    assert cas["tract_te"] == 8.1
    assert cas["h3_te"] == 8.1
    assert cas["local_obs"] == 0.0


def test_cascade_tract_with_high_n_dominates_prior():
    # tract with n=200 and a mean well above zip_te should pull tract_te
    # most of the way to the tract mean (prior 20 << 200).
    logsum = 200 * 9.0  # mean log rent 9.0 vs zip_te 8.1
    te_stats = {"tract": {"06037211500": [200.0, logsum]}, "h3_8": {}, "h3_9": {}}
    cas = _te_cascade(8.1, "06037211500", None, None, te_stats, 7.5)
    # (200*9.0 + 20*8.1)/220 = 8.918...
    assert cas["tract_te"] == pytest.approx((logsum + 20 * 8.1) / 220.0)
    assert cas["tract_te"] > 8.8


def test_two_tracts_yield_different_tract_te():
    te_stats = {
        "tract": {
            "westside": [80.0, 80 * 9.2],   # Hancock Park
            "eastside": [80.0, 80 * 8.3],   # Koreatown
        },
        "h3_8": {}, "h3_9": {},
    }
    west = _te_cascade(8.6, "westside", None, None, te_stats, 7.5)["tract_te"]
    east = _te_cascade(8.6, "eastside", None, None, te_stats, 7.5)["tract_te"]
    assert west > east + 0.4  # the whole point of the model: split the ZIP


def test_h3_obs_counts_reflect_density():
    te_stats = {
        "tract": {},
        "h3_8": {"88283082adfffff": [50.0, 50 * 8.5]},
        "h3_9": {"89283082ad3ffff": [8.0, 8 * 8.6]},
    }
    cas = _te_cascade(8.1, "", "88283082adfffff", "89283082ad3ffff", te_stats, 7.5)
    assert cas["h3_8_obs"] == 50.0
    assert cas["h3_9_obs"] == 8.0


def test_local_surface_hex_hit_returns_hex_psf():
    meta = dict(BASE_META, global_rent_psf=2.0, global_sold_psf=250.0)
    local = {"88283082adfffff": [3.5, 420.0, 12, 4]}
    rent, sold = _local_surface("88283082adfffff", local, meta)
    assert rent == 3.5 and sold == 420.0


def test_local_surface_miss_falls_back_to_global():
    meta = dict(BASE_META, global_rent_psf=2.0, global_sold_psf=250.0)
    rent, sold = _local_surface("8828308200fffff", {}, meta)
    assert rent == 2.0 and sold == 250.0


def test_full_vector_length_with_p1_features():
    meta = dict(
        BASE_META,
        te_stats={"tract": {}, "h3_8": {}, "h3_9": {}},
        local_by_hex={}, tract_income={},
        global_rent_psf=2.0, global_sold_psf=250.0,
    )
    v = vector_from_features(compute_features(ROW, meta), meta)
    assert len(v) == len(FEATURE_NAMES) == 21

  Ran 1 shell command

13/13 green — including the two-tract split test (west > east, the whole point).

Architecture decision: I'll bake the P1 lookup dicts into metadata.json (not a separate sidecar). Rationale — metadata.json already carries the 13K-entry zip_te blob so readability is already gone, and a separate sidecar adds a missing-file failure mode in two readers (eval + serve). Serving uses the frozen train-time surface; the nightly retrain + market-stats refresh keep them in sync. This makes model_store need only a census_tract passthrough. Wire train_v1:

⏺ Update(ml_rent_estimator/train_v1.py)
Added 35 lines, removed 1 line
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml_rent_estimator.dataset import TRAINING_SQL, fit_encoders, frame_to_matrix
from ml_rent_estimator.dataset import (
    TRAINING_SQL,
    add_h3_columns,
    fit_encoders,
    frame_to_matrix,
)


def load_market_stats(conn) -> dict:
    """{h3_8: [rent_psf, sold_psf, n_rent, n_sold]} — each hex's latest
    complete month (rent model v2 P1 local surface, baked into the artifact)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT ON (h3_8) h3_8, med_rent_psf, med_sold_psf, n_rent, n_sold
               FROM h3_market_stats ORDER BY h3_8, stat_month DESC"""
        )
        return {
            r[0]: [
                float(r[1]) if r[1] is not None else None,
                float(r[2]) if r[2] is not None else None,
                int(r[3]), int(r[4]),
            ]
            for r in cur.fetchall()
        }


def load_tract_income(conn) -> dict:
    """{geoid: median_hh_income} — latest ACS vintage per tract."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT ON (geoid) geoid, median_hh_income
               FROM tract_demographics WHERE median_hh_income IS NOT NULL
               ORDER BY geoid, acs_year DESC"""
        )
        return {r[0]: float(r[1]) for r in cur.fetchall()}

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
# Optional argv[1] = subdirectory (the nightly retrain trains into
# 'rent_v1_staging' and only swaps to 'rent_v1' after the eval gate passes).
Found 4 new diagnostic issues in 1 file (ctrl+o to expand)

⏺ Update(ml_rent_estimator/train_v1.py)
Added 11 lines, removed 1 line
    conn = psycopg2.connect(dsn)
    try:
        df = pd.read_sql(TRAINING_SQL, conn, parse_dates=["listing_date"])
        market_stats = load_market_stats(conn)
        tract_income = load_tract_income(conn)
    finally:
        conn.close()
    print(f"loaded {len(df)} rows in {time.time()-t0:.0f}s", flush=True)
    print(
        f"loaded {len(df)} rows, {len(market_stats)} hex stats, "
        f"{len(tract_income)} tract incomes in {time.time()-t0:.0f}s",
        flush=True,
    )

    # Compute H3 cells once for the whole frame (reused by the encoders and
    # both feature-matrix builds).
    df = add_h3_columns(df)

    # Address-hash split (deterministic 90/10), NOT time-based: rental
    # collection only started ~2026-06-05, so "last 30 days" would hold out
    # 93% of the data. Hashing on address also prevents the same unit
Found 3 new diagnostic issues in 1 file (ctrl+o to expand)

⏺ Update(ml_rent_estimator/train_v1.py)
Added 1 line, removed 1 line
    hold_df = df[bucket == 0]
    print(f"train={len(train_df)} holdout={len(hold_df)} (address-hash 90/10)", flush=True)

    meta = fit_encoders(train_df)
    meta = fit_encoders(train_df, market_stats=market_stats, tract_income=tract_income)
    Xt, yt, wt = frame_to_matrix(train_df, meta)
    Xh, yh, _ = frame_to_matrix(hold_df, meta)

Found 3 new diagnostic issues in 1 file (ctrl+o to expand)

Wire add_h3_columns into eval_v1:

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 1 line, removed 1 line
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml_rent_estimator.dataset import TRAINING_SQL, frame_to_matrix
from ml_rent_estimator.dataset import TRAINING_SQL, add_h3_columns, frame_to_matrix

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
# Optional argv[1] = subdirectory to evaluate (nightly retrain evaluates
Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

⏺ Update(ml_rent_estimator/eval_v1.py)
Added 1 line
        conn.close()

    hold = df[(df["split_bucket"].abs() % 10) == 0].reset_index(drop=True)
    hold = add_h3_columns(hold)  # P1 features need the h3 columns
    X, y, _ = frame_to_matrix(hold, meta)
    actual = np.exp(np.asarray(y, dtype=float))

Found 10 new diagnostic issues in 1 file (ctrl+o to expand)

Now P1.5 — census_tract passthrough in model_store + PredictRequest, then the worker payload:

⏺ Update(ml/model_store.py)
Added 1 line
        "lng": req.longitude,
        "ptype": req.property_type,
        "zip": zip_code,
        "census_tract": getattr(req, "census_tract", None),
        "hud_safmr": hud,
        "zcta_med_income": zcta[0],
        "zcta_med_rent": zcta[1],
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

⏺ Update(ml/main.py)
Added 5 lines
    # Wave 2 (optional — the batch path supplies them, the LISTEN path may not)
    lot_sqft: Optional[float] = None
    hoa_fee: Optional[float] = None
    # rent v2 P1/P2: hyperlocal tract key + property history (worker supplies
    # them; older callers omit them and the model uses fallbacks).
    census_tract: Optional[str] = None
    last_sold_price: Optional[float] = None
    last_sold_date: Optional[str] = None


class PredictResponse(BaseModel):
Found 1 new diagnostic issue in 1 file (ctrl+o to expand)

Now the worker payload — read the rent worker's SELECT + ML payload construction:

  Searched for 2 patterns, read 1 file

The single path sends the whole payload object (line 260). Let me read the batch path's query + item mapping (~500-560):

  Searched for 1 pattern, read 1 file

Add the fields across the worker — BatchRow type, batch SELECT + mapping, ListingPayload, loadListing SELECT + return. Batch side first:

⏺ Update(~/Code/OnePercentRealEstate/apps/worker/src/rent-estimator.ts)
Added 3 lines
  readonly property_type: string | null;
  readonly hoa_fee: string | null;
  readonly lot_size_acres: string | null;
  readonly census_tract: string | null;
  readonly last_sold_price: string | null;
  readonly last_sold_date: string | null;
}

async function drainBatch(parentLog: WorkerLogger): Promise<number> {
Referenced file ml/main.py
Read ml/model_store.py (195 lines)
Referenced file ml_rent_estimator/eval_v1.py
Read ml_rent_estimator/train_v1.py (180 lines)
Read ml_rent_estimator/test_dataset.py (148 lines)
Skills restored (superpowers:writing-plans)
SessionStart:compact hook error
Failed with non-blocking status code: /bin/sh: /Users/johnny/.claude/plugins/cache/qiushi-skill/qiushi-skill/1.3.0/hooks/run-hook.cmd: Permission denied
SessionStart:compact says: [services] recent context, 2026-07-08 5:40am PDT
────────────────────────────────────────────────────────────

No previous sessions found for this project yet.

View Observations Live @ http://localhost:37701

BatchRow done. But the worker scores the listings table (for-sale properties), which needs its own census_tract column + backfill — the rental backfill only covered the training table. Let me check both tables' geometry columns before writing that migration: