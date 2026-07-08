"""Unit tests for the eval helpers that don't need lightgbm.

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_eval.py -v
"""
import numpy as np
import pandas as pd

from ml_rent_estimator.eval_v1 import _spearman, highvar_slice


def test_spearman_perfect_monotonic():
    a = np.array([1.0, 2, 3, 4, 5])
    b = np.array([10.0, 20, 30, 40, 50])
    assert _spearman(a, b) > 0.99


def test_spearman_perfect_inverse():
    a = np.array([1.0, 2, 3, 4, 5])
    b = np.array([50.0, 40, 30, 20, 10])
    assert _spearman(a, b) < -0.99


def test_spearman_too_short_is_nan():
    assert _spearman(np.array([1.0]), np.array([2.0])) != _spearman(np.array([1.0]), np.array([2.0]))


def test_highvar_slice_picks_dispersed_zip_and_scores():
    # Two ZIPs: one tight (low log-variance), one split (high variance).
    # Each needs >=30 rows to be eligible.
    rng = np.random.default_rng(0)
    tight = pd.DataFrame({
        "zip": ["11111"] * 40,
        "_actual_seed": rng.normal(2000, 30, 40),
    })
    split = pd.DataFrame({
        "zip": ["90004"] * 40,
        "_actual_seed": np.concatenate([rng.normal(3000, 50, 20), rng.normal(9000, 50, 20)]),
    })
    df = pd.concat([tight, split], ignore_index=True)
    actual = df["_actual_seed"].to_numpy()
    # A model that perfectly ranks within the split ZIP.
    pred = actual * 1.0
    out = highvar_slice(df[["zip"]].copy(), pred, actual)
    assert out["highvar_zip_count"] >= 1
    assert out["within_zip_spearman"] is not None
    assert out["within_zip_spearman"] > 0.9  # perfect ranking


def test_highvar_slice_empty_when_no_eligible_zip():
    df = pd.DataFrame({"zip": ["00001"] * 5})
    actual = np.array([1000.0] * 5)
    out = highvar_slice(df, actual, actual)
    assert out["highvar_zip_count"] == 0
    assert out["highvar_zip_mae"] is None
