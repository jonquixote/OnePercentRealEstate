"""Bounded A/B test for LightGBM hyperparameters (num_leaves, n_estimators).

Evaluates combinations of tree complexity and boosting rounds on the active dataset
and prints comparison metrics (holdout MAE, MAPE, training wall time).
"""
import os
import sys
import time
import json
import pandas as pd
import numpy as np
import psycopg2
import lightgbm as lgb

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml_rent_estimator.dataset import (
    TRAINING_SQL,
    add_h3_columns,
    fit_encoders,
    frame_to_matrix,
)
from ml_rent_estimator.train_v1 import load_market_stats, load_tract_income


def run_ab_test():
    print("=== Starting Hyperparameter A/B Test ===", flush=True)
    t0 = time.time()
    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        df = pd.read_sql(TRAINING_SQL, conn, parse_dates=["listing_date"])
        market_stats = load_market_stats(conn)
        tract_income = load_tract_income(conn)
    finally:
        conn.close()
        
    print(
        f"Loaded {len(df)} rows, {len(market_stats)} hex stats, "
        f"{len(tract_income)} tract incomes in {time.time()-t0:.0f}s",
        flush=True,
    )

    df = add_h3_columns(df)
    bucket = df["split_bucket"].abs() % 10
    train_df = df[bucket != 0]
    hold_df = df[bucket == 0]
    print(f"Train={len(train_df)} holdout={len(hold_df)} (address-hash 90/10)", flush=True)

    meta = fit_encoders(train_df, market_stats=market_stats, tract_income=tract_income)
    Xt, yt, wt = frame_to_matrix(train_df, meta)
    Xh, yh, _ = frame_to_matrix(hold_df, meta)

    train_set = lgb.Dataset(Xt, label=yt, weight=wt, feature_name=meta["feature_names"])
    actual = np.exp(np.asarray(yh, dtype=float))

    # Grid search space
    num_leaves_opts = [31, 63, 127]
    n_estimators_opts = [200, 400, 600]

    results = []
    
    # Base parameters matching train_v1.py
    base_params = {
        "learning_rate": 0.06,
        "min_data_in_leaf": 40,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "feature_fraction": 0.9,
        "num_threads": 2,
        "verbose": -1,
        "objective": "quantile",
        "alpha": 0.5  # p50 median
    }

    for num_leaves in num_leaves_opts:
        for n_estimators in n_estimators_opts:
            print(f"\nEvaluating: num_leaves={num_leaves}, n_estimators={n_estimators}...", flush=True)
            params = {**base_params, "num_leaves": num_leaves}
            
            t_start = time.time()
            booster = lgb.train(
                params,
                train_set,
                num_boost_round=n_estimators,
            )
            t_duration = time.time() - t_start
            
            pred = np.exp(np.asarray(booster.predict(Xh), dtype=float))
            mae = float(np.mean(np.abs(pred - actual)))
            mape = float(np.mean(np.abs(pred - actual) / actual))
            
            print(f"  Result: MAE = ${mae:.2f} | MAPE = {mape*100:.2f}% | Time = {t_duration:.1f}s", flush=True)
            results.append({
                "num_leaves": num_leaves,
                "n_estimators": n_estimators,
                "holdout_mae_p50": mae,
                "holdout_mape_p50": mape,
                "train_time_s": t_duration
            })

    # Print summary table
    print("\n\n=== A/B Test Results Summary ===", flush=True)
    print(f"{'num_leaves':<12} | {'n_estimators':<12} | {'Holdout MAE':<12} | {'Holdout MAPE':<12} | {'Train Time (s)':<15}", flush=True)
    print("-" * 75, flush=True)
    for r in results:
        print(f"{r['num_leaves']:<12} | {r['n_estimators']:<12} | ${r['holdout_mae_p50']:<11.2f} | {r['holdout_mape_p50']*100:<11.2f}% | {r['train_time_s']:<15.1f}", flush=True)
    print("-" * 75, flush=True)

    # Save results to output JSON
    out_path = os.path.join(os.environ.get("MODEL_DIR", "/models"), "ab_test_results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved results to {out_path}", flush=True)


if __name__ == "__main__":
    run_ab_test()
