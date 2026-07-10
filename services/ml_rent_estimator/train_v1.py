"""Train rent model v1: LightGBM quantile heads (p10/p50/p90) on rental comps.

Replaces the dead Supabase-era train_model.py. Runs inside the ml container:

    docker exec infrastructure-ml-1 python -m ml_rent_estimator.train_v1

Reads DATABASE_URL. Writes artifacts to $MODEL_DIR/rent_v1/:
    p10.txt, p50.txt, p90.txt   (LightGBM native — no pickle)
    metadata.json               (feature names + encoders + train stats)

Split: deterministic address-hash 90/10 (see below); encoders fit on train only.
Sample weights: exp(-age_days/180) recency decay.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import timedelta
from typing import Any

import numpy as np
import pandas as pd
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


def load_hpi_cagr(conn) -> dict:
    """{zip5: cagr} — 5-year CAGR of FHFA ZIP HPI."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (zip5) zip5, year,
                   CASE WHEN hpi > 0 AND lag_hpi > 0 THEN (hpi / lag_hpi) ^ (1.0/5.0) - 1.0 ELSE 0.0 END
            FROM (SELECT zip5, hpi, year, LAG(hpi, 5) OVER (PARTITION BY zip5 ORDER BY year) AS lag_hpi
                  FROM fhfa_zip_hpi) sub
            WHERE lag_hpi IS NOT NULL AND lag_hpi > 0
            ORDER BY zip5, year DESC
        """)
        return {r[0]: float(r[1]) for r in cur.fetchall()}


def load_tract_walk(conn) -> dict:
    """{geoid: natwalkind} — EPA National Walkability Index."""
    with conn.cursor() as cur:
        cur.execute("SELECT geoid, natwalkind FROM tract_walkability WHERE natwalkind IS NOT NULL")
        return {r[0]: float(r[1]) for r in cur.fetchall()}


def load_county_unemp(conn) -> dict:
    """{fips: rate} — latest BLS county unemployment rate."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (fips) fips, unemployment_rate
            FROM bls_county_laus WHERE unemployment_rate IS NOT NULL ORDER BY fips, period DESC
        """)
        return {r[0]: float(r[1]) for r in cur.fetchall()}


def load_county_disasters(conn) -> dict:
    """{fips: total} — FEMA disaster declarations last 10 years."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT fips, SUM(declarations)::float FROM fema_disasters
            WHERE fy >= EXTRACT(YEAR FROM now()) - 10 GROUP BY fips
        """)
        return {r[0]: float(r[1]) for r in cur.fetchall()}


def load_county_crime(conn) -> dict:
    """{fips: violent_per_100k} — violent crime rate per 100k."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (fips) fips, violent_per_100k FROM crime_county
            WHERE violent_per_100k IS NOT NULL AND agencies_reporting >= 2
            ORDER BY fips, year DESC
        """)
        return {r[0]: float(r[1]) for r in cur.fetchall()}

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
# Optional argv[1] = subdirectory (the nightly retrain trains into
# 'rent_v1_staging' and only swaps to 'rent_v1' after the eval gate passes).
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
    num_leaves=NUM_LEAVES,
    min_data_in_leaf=40,
    bagging_fraction=0.9,
    bagging_freq=1,
    feature_fraction=0.9,
    num_threads=2,
    verbose=-1,
)
NUM_ROUNDS = N_ESTIMATORS


def main() -> None:
    import lightgbm as lgb

    t0 = time.time()
    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        df = pd.read_sql(TRAINING_SQL, conn, parse_dates=["listing_date"])
        market_stats = load_market_stats(conn)
        tract_income = load_tract_income(conn)
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
        # (relisted across dates) leaking between train and holdout. Revisit a
        # true time split once several months of history exist.
        bucket = df["split_bucket"].abs() % 10
        train_df = df[bucket != 0]
        hold_df = df[bucket == 0]
        print(f"train={len(train_df)} holdout={len(hold_df)} (address-hash 90/10)", flush=True)

        meta = fit_encoders(train_df, market_stats=market_stats, tract_income=tract_income, conn=conn)
        Xt, yt, wt = frame_to_matrix(train_df, meta)
        Xh, yh, _ = frame_to_matrix(hold_df, meta)
    finally:
        conn.close()

    os.makedirs(OUT_DIR, exist_ok=True)
    train_set = lgb.Dataset(Xt, label=yt, weight=wt, feature_name=meta["feature_names"])
    quick = {}
    for name, alpha in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9)):
        # P3 band calibration: quantile tails need smaller leaves and slower
        # learning to capture the distribution properly. p50 keeps the base params.
        qparams = {**PARAMS, "objective": "quantile", "alpha": alpha}
        if name in ("p10", "p90"):
            qparams["min_data_in_leaf"] = 2
            qparams["learning_rate"] = 0.015
        booster = lgb.train(
            qparams,
            train_set,
            num_boost_round=NUM_ROUNDS,
        )
        booster.save_model(os.path.join(OUT_DIR, f"{name}.txt"))
        if name == "p50":
            pred = np.exp(np.asarray(booster.predict(Xh), dtype=float))
            actual = np.exp(np.asarray(yh, dtype=float))
            quick["holdout_mae_p50"] = float(np.mean(np.abs(pred - actual)))
            quick["holdout_mape_p50"] = float(np.mean(np.abs(pred - actual) / actual))
        print(f"trained {name} ({time.time()-t0:.0f}s elapsed)", flush=True)

    meta_out = {
        **meta,
        "version": "v1",
        "trained_at": pd.Timestamp.utcnow().isoformat(),
        "train_rows": int(len(train_df)),
        "holdout_rows": int(len(hold_df)),
        "split": "address-hash 90/10",
        "params": PARAMS,
        "quick_eval": quick,
    }
    with open(os.path.join(OUT_DIR, "metadata.json"), "w") as f:
        json.dump(meta_out, f)

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
    main()
