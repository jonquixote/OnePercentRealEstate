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

import json
import os
import sys

import numpy as np
import pandas as pd
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml_rent_estimator.dataset import TRAINING_SQL, frame_to_matrix

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
# Optional argv[1] = subdirectory to evaluate (nightly retrain evaluates
# 'rent_v1_staging' before promotion).
_SUBDIR = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "rent_v1"
OUT_DIR = os.path.join(MODEL_DIR, _SUBDIR)
V0_SAMPLE = 2000


def mae(pred: np.ndarray, actual: np.ndarray) -> float:
    return float(np.mean(np.abs(pred - actual)))


def main() -> None:
    import lightgbm as lgb

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
    X, y, _ = frame_to_matrix(hold, meta)
    actual = np.exp(np.asarray(y, dtype=float))

    pred = {q: np.exp(np.asarray(b.predict(X), dtype=float)) for q, b in boosters.items()}

    # HUD baseline: the hud_anchor feature IS log(safmr-with-fallback) — column 10.
    hud_pred = np.exp(X[:, 10])

    overall = {
        "rows": int(len(hold)),
        "v1_mae": mae(pred["p50"], actual),
        "v1_mape": float(np.mean(np.abs(pred["p50"] - actual) / actual)),
        "hud_mae": mae(hud_pred, actual),
        "band_coverage": float(np.mean((actual >= pred["p10"]) & (actual <= pred["p90"]))),
    }

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
    gate_pass = gate_ratio <= 0.85 and wins >= 10
    metrics = {
        "overall": overall,
        "per_state": per_state,
        "state_wins_vs_hud": wins,
        "gate": {"ratio": gate_ratio, "wins": wins, "pass": gate_pass},
        "v0_sample": v0_metrics,
        "trained_at": meta.get("trained_at"),
        "train_rows": meta.get("train_rows"),
    }

    conn = psycopg2.connect(dsn)
    try:
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
                    str(hash(tuple(meta["feature_names"]))),
                    json.dumps(metrics),
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
