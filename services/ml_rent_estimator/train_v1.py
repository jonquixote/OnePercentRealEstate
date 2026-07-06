"""Train rent model v1: LightGBM quantile heads (p10/p50/p90) on rental comps.

Replaces the dead Supabase-era train_model.py. Runs inside the ml container:

    docker exec infrastructure-ml-1 python -m ml_rent_estimator.train_v1

Reads DATABASE_URL. Writes artifacts to $MODEL_DIR/rent_v1/:
    p10.txt, p50.txt, p90.txt   (LightGBM native — no pickle)
    metadata.json               (feature names + encoders + train stats)

Split: holdout = last 30 days by listing_date; encoders fit on train only.
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
from ml_rent_estimator.dataset import TRAINING_SQL, fit_encoders, frame_to_matrix

MODEL_DIR = os.environ.get("MODEL_DIR", "/models")
OUT_DIR = os.path.join(MODEL_DIR, "rent_v1")

# Native lightgbm.train params (the sklearn wrapper would drag in a
# scikit-learn dependency for nothing).
PARAMS: dict[str, Any] = dict(
    learning_rate=0.06,
    num_leaves=63,
    min_data_in_leaf=40,
    bagging_fraction=0.9,
    bagging_freq=1,
    feature_fraction=0.9,
    num_threads=2,
    verbose=-1,
)
NUM_ROUNDS = 400


def main() -> None:
    import lightgbm as lgb

    t0 = time.time()
    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        df = pd.read_sql(TRAINING_SQL, conn, parse_dates=["listing_date"])
    finally:
        conn.close()
    print(f"loaded {len(df)} rows in {time.time()-t0:.0f}s", flush=True)

    # Address-hash split (deterministic 90/10), NOT time-based: rental
    # collection only started ~2026-06-05, so "last 30 days" would hold out
    # 93% of the data. Hashing on address also prevents the same unit
    # (relisted across dates) leaking between train and holdout. Revisit a
    # true time split once several months of history exist.
    bucket = df["split_bucket"].abs() % 10
    train_df = df[bucket != 0]
    hold_df = df[bucket == 0]
    print(f"train={len(train_df)} holdout={len(hold_df)} (address-hash 90/10)", flush=True)

    meta = fit_encoders(train_df)
    Xt, yt, wt = frame_to_matrix(train_df, meta)
    Xh, yh, _ = frame_to_matrix(hold_df, meta)

    os.makedirs(OUT_DIR, exist_ok=True)
    train_set = lgb.Dataset(Xt, label=yt, weight=wt, feature_name=meta["feature_names"])
    quick = {}
    for name, alpha in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9)):
        booster = lgb.train(
            {**PARAMS, "objective": "quantile", "alpha": alpha},
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

    print(json.dumps({"done": True, "wall_s": round(time.time() - t0), **quick}), flush=True)


if __name__ == "__main__":
    main()
