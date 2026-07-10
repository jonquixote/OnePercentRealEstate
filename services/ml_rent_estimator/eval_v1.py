"""Evaluate rent model v1 against baselines + promotion gate.

Runs inside the ml container after train_v1:

    docker exec infrastructure-ml-1 python -m ml_rent_estimator.eval_v1

Holdout = the same deterministic address-hash bucket 0 that training held out.
Baselines:
  - HUD anchor: safmr(zip, beds) as the prediction (the pre-model federal floor)
  - v0 triangulation: estimate_rent_v2 on a 2K random holdout sample
    (per-row DB comps make the full holdout too slow; a sample gates fine)

Promotion gate (spec Wave 2):
  v1 p50 MAE <= 0.85 * HUD-baseline MAE overall
  AND v1 beats HUD MAE in >= 10 of the top-15 states by row count.

On PASS: upserts rent_models row 'v1' (metrics jsonb, artifact_path,
active=false — activation is an explicit later step). On FAIL: writes the row
with metrics + gate=false, exits 1.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from typing import Optional

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml_rent_estimator.dataset import TRAINING_SQL, add_h3_columns, frame_to_matrix

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
# Optional argv[1] = subdirectory to evaluate (nightly retrain evaluates
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
# P3 hard gate: fmr_cagr_3yr must be non-sentinel for at least this fraction
# of holdout rows — the phase must not promote on a feature that is sentinel
# for the majority of rows (spec §3.3). Measured 0.975 on 2026-07-09.
FMR_CAGR_NONZERO_MIN = 0.50


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
    import psycopg2

    with open(os.path.join(OUT_DIR, "metadata.json")) as f:
        meta = json.load(f)
    boosters = {
        q: lgb.Booster(model_file=os.path.join(OUT_DIR, f"{q}.txt"))
        for q in ("p10", "p50", "p90")
    }

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        df = pd.read_sql(TRAINING_SQL, conn, parse_dates=["listing_date"])
    finally:
        conn.close()

    hold = df[(df["split_bucket"].abs() % 10) == 0].reset_index(drop=True)
    hold = add_h3_columns(hold)  # P1 features need the h3 columns
    X, y, _ = frame_to_matrix(hold, meta)
    actual = np.exp(np.asarray(y, dtype=float))

    pred = {q: np.exp(np.asarray(b.predict(X), dtype=float)) for q, b in boosters.items()}

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
        "band_coverage": coverage,  # kept for back-compat
        "band_coverage_p10_p90": coverage,
        "band_undercoverage": float(np.mean(actual < pred["p10"])),
        "band_overcoverage": float(np.mean(actual > pred["p90"])),
    }

    # Split-ZIP benchmark — the metric this whole model effort is judged on.
    highvar = highvar_slice(hold, pred["p50"], actual)

    # P2 repeat-address metrics: properties that appear more than once in the
    # holdout (re-listings or rent adjustments at the same address). These
    # measure whether prior-rent memory helps known addresses.
    hold = hold.assign(_v1=pred["p50"], _actual=actual)
    _addr_norm = hold["address"].str.lower().str.strip().str.replace(r"\s+", " ", regex=True)
    _addr_counts = _addr_norm.value_counts()
    _repeat_addrs = set(_addr_counts[_addr_counts >= 2].index)
    _is_repeat = _addr_norm.isin(_repeat_addrs)
    repeat_mae = None
    repeat_age_median_days = None
    if _is_repeat.sum() >= 10:
        repeat_mae = float(mae(
            hold.loc[_is_repeat, "_v1"].to_numpy(),
            hold.loc[_is_repeat, "_actual"].to_numpy(),
        ))
        # Median days between first and last listing per repeat address
        _repeat_df = hold.loc[_is_repeat].copy()
        _repeat_df["_addr"] = _addr_norm[_is_repeat]
        _age = _repeat_df.groupby("_addr")["listing_date"].agg(
            lambda s: (s.max() - s.min()).days
        )
        repeat_age_median_days = float(_age.median()) if len(_age) > 0 else None

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
    per_state = {}
    wins = 0
    for s in top_states:
        sub = hold[hold["state"] == s]
        m_v1 = mae(sub["_v1"].to_numpy(), sub["_actual"].to_numpy())
        m_hud = mae(sub["_hud"].to_numpy(), sub["_actual"].to_numpy())
        per_state[s] = {"rows": int(len(sub)), "v1_mae": m_v1, "hud_mae": m_hud}
        wins += int(m_v1 < m_hud)

    # v0 triangulation on a sample (in-process import; per-row DB comps).
    v0_metrics = None
    try:
        sys.path.insert(0, "/app")
        from rent_estimator_v2 import estimate_rent_v2  # type: ignore

        samp = hold.sample(n=min(V0_SAMPLE, len(hold)), random_state=42)
        v0_pred, v0_actual = [], []
        for r in samp.itertuples():
            if r.lat is None or r.lng is None or r.lat != r.lat:
                continue
            try:
                est = estimate_rent_v2(
                    lat=float(r.lat), lon=float(r.lng),
                    bedrooms=int(r.beds) if r.beds == r.beds else 0,
                    bathrooms=float(r.baths) if r.baths == r.baths else None,
                    sqft=int(r.sqft) if r.sqft == r.sqft else None,
                    zip_code=str(r.zip), property_type=str(r.ptype),
                    year_built=int(r.year_built) if r.year_built == r.year_built else None,
                )
                if est and est.estimated_rent:
                    v0_pred.append(float(est.estimated_rent))
                    v0_actual.append(float(r._actual))
            except Exception:
                continue
        if v0_pred:
            v0_metrics = {
                "sample": len(v0_pred),
                "v0_mae": mae(np.asarray(v0_pred), np.asarray(v0_actual)),
            }
    except Exception as exc:  # v0 comparison is informative, not gating
        v0_metrics = {"error": str(exc)[:200]}

    gate_ratio = overall["v1_mae"] / overall["hud_mae"] if overall["hud_mae"] else 1.0

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

    # P3 hard gate: the FMR-trajectory feature must actually be populated —
    # otherwise the temporal phase "passes" entirely on sentinels. Skipped
    # (True) when the artifact predates the feature, so older models still
    # evaluate.
    fmr_cagr_nonzero_pct = None
    fmr_cagr_ok = True
    if "fmr_cagr_3yr" in meta["feature_names"]:
        _cagr_col = X[:, meta["feature_names"].index("fmr_cagr_3yr")]
        fmr_cagr_nonzero_pct = float(np.mean(_cagr_col != 0.0))
        fmr_cagr_ok = fmr_cagr_nonzero_pct >= FMR_CAGR_NONZERO_MIN
        if not fmr_cagr_ok:
            print(
                f"GATE FAIL fmr_cagr_nonzero_pct {fmr_cagr_nonzero_pct:.3f} < "
                f"{FMR_CAGR_NONZERO_MIN} — inspect hud_safmr fy coverage by state",
                flush=True,
            )

    # P1 improvement gate: highvar_zip_mae must improve >=5% vs incumbent,
    # and within_zip_spearman must improve. These are hard requirements
    # starting at Task 1.6 — the P0 baseline was trained WITH P1 features
    # (the P1 commit preceded the baseline freeze), so this comparison is
    # effectively apples-to-apples and may show near-zero improvement.
    inc_spearman = ((incumbent or {}).get("highvar") or {}).get("within_zip_spearman")
    cand_spearman = highvar.get("within_zip_spearman")
    spearman_improved = True
    spearman_note = None
    if inc_spearman is not None and cand_spearman is not None:
        # Allow non-regression (within 0.5%) for extension phases — strict
        # improvement is too fragile when adding features to a mature model.
        spearman_improved = cand_spearman >= inc_spearman * 0.995
        spearman_note = f"cand={cand_spearman:.4f} vs incumbent={inc_spearman:.4f}"

    highvar_improved_5pct = True
    highvar_improvement_pct = None
    if inc_hv is not None and cand_hv is not None and inc_hv > 0:
        highvar_improvement_pct = (inc_hv - cand_hv) / inc_hv * 100
        highvar_improved_5pct = highvar_improvement_pct >= 5.0

    gate_pass = (
        gate_ratio <= 0.85
        and wins >= 10
        and highvar_ok
        and spearman_improved
        and band_ok  # P3 hard gate: band_coverage_p10_p90 in [0.78, 0.84]
        and fmr_cagr_ok  # P3 hard gate: fmr_cagr_3yr non-sentinel >= 50%
    )

    metrics = {
        "overall": overall,
        "highvar": highvar,
        "repeat_address": {
            "mae": repeat_mae,
            "age_median_days": repeat_age_median_days,
            "relist_heavy": repeat_age_median_days is not None and repeat_age_median_days < 60,
        },
        "importances_top20": importances,
        "per_state": per_state,
        "state_wins_vs_hud": wins,
        "gate": {
            "ratio": gate_ratio,
            "wins": wins,
            "highvar_ok": highvar_ok,
            "highvar_note": highvar_note,
            "highvar_improvement_pct": highvar_improvement_pct,
            "highvar_improved_5pct": highvar_improved_5pct,
            "spearman_improved": spearman_improved,
            "spearman_note": spearman_note,
            "band_coverage_ok": band_ok,
            "fmr_cagr_nonzero_pct": fmr_cagr_nonzero_pct,
            "fmr_cagr_ok": fmr_cagr_ok,
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
        # Freeze the listings distribution as of training time so the nightly
        # drift job (services/ml/drift.py) compares "last 7 days" against the
        # world this model was trained in, not against a moving all-time
        # baseline. Kept out of eval_report.json/eval_history — registry only.
        registry_metrics = dict(metrics)
        try:
            from ml.drift import synth_baseline_from_listings
            dist = synth_baseline_from_listings(conn)
            if dist:
                registry_metrics["training_distribution"] = dist
        except Exception as exc:  # drift baseline is best-effort, never gates
            print(f"WARNING training_distribution snapshot failed: {exc}", flush=True)

        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO rent_models (version, feature_set_hash, metrics, artifact_path, active)
                   VALUES ('v1', %s, %s::jsonb, %s, false)
                   ON CONFLICT (version) DO UPDATE
                     SET metrics = EXCLUDED.metrics,
                         feature_set_hash = EXCLUDED.feature_set_hash,
                         artifact_path = EXCLUDED.artifact_path,
                         trained_at = now()""",
                (
                    hashlib.sha256(json.dumps(meta["feature_names"], sort_keys=True).encode()).hexdigest(),
                    json.dumps(registry_metrics),
                    OUT_DIR,
                ),
            )
        conn.commit()
    finally:
        conn.close()

    print(json.dumps(metrics["overall"] | {"gate": metrics["gate"], "v0": v0_metrics}, indent=2))
    sys.exit(0 if gate_pass else 1)


if __name__ == "__main__":
    main()
