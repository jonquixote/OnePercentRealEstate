"""Unit tests for the feature builder. These cover only pure-python feature
logic (no lightgbm), so they run anywhere pandas/numpy are present:

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_dataset.py -v
"""
import math
from datetime import date

import pytest

from ml_rent_estimator.dataset import (
    FEATURE_NAMES,
    compute_features,
    vector_from_features,
    _parse_date,
    _fmr_cagr,
    _growth_frac,
)

BASE_META = {
    "feature_names": list(FEATURE_NAMES),
    "global_mean_log": 7.5,
    "zip_te": {"90004": 8.1},
    "ptype_map": {"SINGLE_FAMILY": 3},
    "hud_beds_median": {"3": 2200.0},
    "sqft_median_by_beds": {"3": 1400.0},
    "zcta_income_global_median": 60000.0,
    "zcta_rent_global_median": 1000.0,
}
ROW = {
    "beds": 3, "baths": 2, "sqft": 1500, "year_built": 1950,
    "lot_sqft": 6000, "hoa_fee": 0, "lat": 34.07, "lng": -118.31,
    "ptype": "SINGLE_FAMILY", "zip": "90004", "hud_safmr": 2400,
    "zcta_med_income": 70000, "zcta_med_rent": 1800,
}


def test_vector_order_follows_meta_not_module():
    # An OLD artifact that only knows the first 11 features must still be
    # servable by NEW code: vector length == len(meta.feature_names).
    meta = dict(BASE_META, feature_names=list(FEATURE_NAMES[:11]))
    v = vector_from_features(compute_features(ROW, meta), meta)
    assert len(v) == 11


def test_vector_matches_current_feature_count():
    v = vector_from_features(compute_features(ROW, BASE_META), BASE_META)
    assert len(v) == len(FEATURE_NAMES)
    assert v[0] == 3.0 and v[1] == 2.0            # beds, baths
    assert v[2] == pytest.approx(math.log(1500))  # sqft_log


def test_compute_features_returns_superset_dict():
    feats = compute_features(ROW, BASE_META)
    # Every registered feature name must be computable.
    for name in FEATURE_NAMES:
        assert name in feats, f"missing feature {name}"


def test_unknown_feature_name_in_meta_raises():
    meta = dict(BASE_META, feature_names=["beds", "not_a_feature"])
    with pytest.raises(KeyError):
        vector_from_features(compute_features(ROW, meta), meta)


def test_build_feature_row_still_works():
    # Back-compat: the old entrypoint must keep producing the same vector.
    from ml_rent_estimator.dataset import build_feature_row
    v = build_feature_row(ROW, BASE_META)
    assert len(v) == len(FEATURE_NAMES)
    assert v[0] == 3.0


def test_missing_values_use_defaults():
    sparse = {"zip": "99999", "ptype": "UNKNOWN"}
    v = vector_from_features(compute_features(sparse, BASE_META), BASE_META)
    assert len(v) == len(FEATURE_NAMES)
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
    assert len(v) == len(FEATURE_NAMES) == 33


# --- P2 property history ---


def test_p2_sentinel_values_when_no_history():
    """No sale data, no prior rent → all P2 features at sentinel values."""
    feats = compute_features(ROW, BASE_META)
    assert feats["years_since_last_sale"] == -1.0
    assert feats["last_sold_ppsf_log"] == 0.0
    assert feats["last_sold_vs_local"] == 1.0
    assert feats["last_sold_ratio_present"] == 0.0
    assert feats["prior_rent_log"] == 0.0
    assert feats["months_since_prior_rent"] == -1.0


def test_p2_sale_history_populates_features():
    """With valid sale data, features should be computed."""
    row = dict(ROW, last_sold_price=600000, last_sold_date="2024-01-15")
    feats = compute_features(row, BASE_META, asof=date(2026, 7, 1))
    assert feats["years_since_last_sale"] > 2.0
    assert feats["years_since_last_sale"] < 3.0
    assert feats["last_sold_ppsf_log"] > 0  # log(600000/1500) ≈ 5.99
    assert feats["last_sold_ppsf_log"] == pytest.approx(math.log(600000 / 1500))


def test_p2_leakage_guard_future_sale():
    """last_sold_date >= listing_date → treat as missing (leakage)."""
    row = dict(ROW, last_sold_price=500000, last_sold_date="2026-08-01")
    feats = compute_features(row, BASE_META, asof=date(2026, 7, 1))
    # Sale is AFTER reference date → sentinel
    assert feats["years_since_last_sale"] == -1.0
    assert feats["last_sold_ppsf_log"] == 0.0


def test_p2_last_sold_ratio_present_flips():
    """Ratio present should be 1.0 only when local surface is NOT global fallback."""
    meta = dict(
        BASE_META,
        te_stats={"tract": {}, "h3_8": {}, "h3_9": {}},
        local_by_hex={"88283082adfffff": [2.5, 350.0, 20, 8]},
        tract_income={},
        global_rent_psf=2.0, global_sold_psf=250.0,
    )
    # Row with h3 match → real local surface → ratio_present = 1.0
    row = dict(ROW, last_sold_price=500000, last_sold_date="2024-01-01",
               h3_8="88283082adfffff")
    feats = compute_features(row, meta, asof=date(2026, 7, 1))
    assert feats["last_sold_ratio_present"] == 1.0
    assert feats["last_sold_vs_local"] != 1.0

    # Row WITHOUT h3 match → global sold fallback → ratio_present = 0.0
    row_no_h3 = dict(ROW, last_sold_price=500000, last_sold_date="2024-01-01",
                     h3_8="8828308200fffff")  # misses local_by_hex
    feats_no = compute_features(row_no_h3, meta, asof=date(2026, 7, 1))
    assert feats_no["last_sold_ratio_present"] == 0.0
    assert feats_no["last_sold_vs_local"] == 1.0


def test_p2_prior_rent_from_lag():
    """Training path: prior_rent from SQL LAG() should populate features."""
    row = dict(ROW, prior_rent=2500, prior_rent_date="2026-05-01")
    feats = compute_features(row, BASE_META, asof=date(2026, 7, 1))
    assert feats["prior_rent_log"] == pytest.approx(math.log(2500))
    assert feats["months_since_prior_rent"] > 1.5
    assert feats["months_since_prior_rent"] < 2.5


def test_p2_cold_start_empty_cache_valid_vectors():
    """With no rent_memory (cold start), all P2 prior-rent features sentinel."""
    row = dict(ROW)  # no prior_rent key at all
    feats = compute_features(row, BASE_META)
    v = vector_from_features(feats, BASE_META)
    assert len(v) == len(FEATURE_NAMES)
    # All values should be finite
    for i, val in enumerate(v):
        assert math.isfinite(val), f"feature {FEATURE_NAMES[i]} is not finite: {val}"


def test_p2_parse_date_various_inputs():
    """_parse_date handles None, str, date, and pandas-like objects."""
    assert _parse_date(None) is None
    assert _parse_date(date(2024, 1, 15)) == date(2024, 1, 15)
    assert _parse_date("2024-01-15") == date(2024, 1, 15)
    assert _parse_date("not-a-date") is None
    assert _parse_date(42) is None


def test_p2_old_artifact_still_servable_with_21_features():
    """A P1-era artifact with 21 features should still be servable by P2 code."""
    meta = dict(BASE_META, feature_names=list(FEATURE_NAMES[:21]))
    row = dict(ROW, last_sold_price=500000, last_sold_date="2024-01-15")
    v = vector_from_features(compute_features(row, meta, asof=date(2026, 7, 1)), meta)
    assert len(v) == 21  # P2/P3 features computed but not emitted


# --- P3 temporal anchors ---


def test_p3_fmr_cagr_computation():
    """_fmr_cagr computes (current/old)^(1/3) - 1."""
    # 2000 -> 2300 over 3yr: (2300/2000)^(1/3) - 1 ≈ 0.0477
    assert _fmr_cagr(2300, 2000) == pytest.approx(0.0477, abs=0.001)
    # Identical values -> 0 growth
    assert _fmr_cagr(1500, 1500) == pytest.approx(0.0)
    # Decline: 1800 -> 1500
    assert _fmr_cagr(1500, 1800) < 0


def test_p3_fmr_cagr_sentinel_on_missing():
    """_fmr_cagr returns 0.0 sentinel when either value is missing."""
    assert _fmr_cagr(None, 2000) == 0.0
    assert _fmr_cagr(2000, None) == 0.0
    assert _fmr_cagr(None, None) == 0.0
    assert _fmr_cagr(0, 2000) == 0.0  # zero not valid
    assert _fmr_cagr(-100, 2000) == 0.0  # negative not valid


def test_p3_growth_frac_computation():
    """_growth_frac computes (current - old) / old."""
    assert _growth_frac(70000, 60000) == pytest.approx(1 / 6)
    assert _growth_frac(60000, 60000) == pytest.approx(0.0)
    assert _growth_frac(50000, 60000) == pytest.approx(-1 / 6)


def test_p3_growth_frac_sentinel_on_missing():
    assert _growth_frac(None, 60000) == 0.0
    assert _growth_frac(60000, None) == 0.0
    assert _growth_frac(60000, 0) == 0.0
    assert _growth_frac(60000, -1000) == 0.0


def test_p3_trajectory_features_populate():
    """With both current and historical HUD/ZCTA, trajectory features compute."""
    row = dict(ROW, hud_safmr_3yr_ago=2000,
               zcta_med_income_5yr_ago=55000, zcta_med_rent_5yr_ago=1500)
    feats = compute_features(row, BASE_META)
    assert feats["fmr_cagr_3yr"] != 0.0  # 2400 vs 2000
    assert feats["zcta_income_growth_5yr"] == pytest.approx((70000 - 55000) / 55000)
    assert feats["zcta_rent_growth_5yr"] == pytest.approx((1800 - 1500) / 1500)


def test_p3_trajectory_sentinel_when_no_history():
    """Without historical data, trajectory features are 0.0 sentinel."""
    feats = compute_features(ROW, BASE_META)
    assert feats["fmr_cagr_3yr"] == 0.0
    assert feats["zcta_income_growth_5yr"] == 0.0
    assert feats["zcta_rent_growth_5yr"] == 0.0


def test_p3_old_artifact_27_features_still_servable():
    """A P2-era artifact with 27 features should still be servable."""
    meta = dict(BASE_META, feature_names=list(FEATURE_NAMES[:27]))
    row = dict(ROW, hud_safmr_3yr_ago=2000)
    v = vector_from_features(compute_features(row, meta), meta)
    assert len(v) == 27


def test_p3_metro_aware_decay_weights():
    """frame_to_matrix computes shorter decay (lower weight for old items) when CAGR is high."""
    import pandas as pd
    import numpy as np
    from ml_rent_estimator.dataset import frame_to_matrix

    # Two rows: both listing_date 180 days ago.
    # Row 1: High growth (cagr ~ 0.10)
    # Row 2: No growth (cagr ~ 0.0)
    # Row 3: Missing growth (old = None)
    df = pd.DataFrame([
        # Row 1: 2300 vs 1700 (high growth)
        {**ROW, "rent": 2000.0, "listing_date": pd.Timestamp("2026-01-01"), "hud_safmr": 2300.0, "hud_safmr_3yr_ago": 1700.0},
        # Row 2: 2000 vs 2000 (no growth)
        {**ROW, "rent": 2000.0, "listing_date": pd.Timestamp("2026-01-01"), "hud_safmr": 2000.0, "hud_safmr_3yr_ago": 2000.0},
        # Row 3: Missing historical FMR (fallback)
        {**ROW, "rent": 2000.0, "listing_date": pd.Timestamp("2026-01-01"), "hud_safmr": 2000.0, "hud_safmr_3yr_ago": None},
    ])
    df["listing_date"] = pd.to_datetime(df["listing_date"])
    
    # Set max listing_date to today (180 days later) to force age_days = 180
    df = pd.concat([
        df,
        pd.DataFrame([{**ROW, "rent": 2000.0, "listing_date": pd.Timestamp("2026-06-30"), "hud_safmr": 2000.0, "hud_safmr_3yr_ago": 2000.0}])
    ], ignore_index=True)
    df["listing_date"] = pd.to_datetime(df["listing_date"])

    meta = dict(BASE_META, te_stats={"tract": {}}, local_by_hex={}, tract_income={})
    _, _, w = frame_to_matrix(df, meta)
    
    # Row 0: high growth -> shorter decay -> lower weight
    # Row 1: no growth -> base 365.0 decay -> higher weight than Row 0
    # Row 2: missing growth -> fallback 365.0 decay -> same weight as Row 1
    # Row 3: age_days = 0 -> weight = 1.0
    assert w[3] == 1.0
    assert w[0] < w[1]
    assert w[1] == pytest.approx(w[2])
    # Weight for 180 days with 365 decay: exp(-180/365) ≈ 0.61
    assert w[1] == pytest.approx(np.exp(-180.0 / 365.0))


# --- ext: tax assessed value features ---


def test_ext_tax_assessed_sentinel_when_missing():
    """No tax assessed value → all ext features at sentinel values."""
    feats = compute_features(ROW, BASE_META)
    assert feats["tax_assessed_log"] == 0.0
    assert feats["list_to_assessed_ratio"] == 1.0
    assert feats["assessed_ratio_present"] == 0.0


def test_ext_tax_assessed_populates_features():
    """With valid tax assessed value, features should be computed."""
    row = dict(ROW, tax_assessed_value=500000, rent=2000)
    feats = compute_features(row, BASE_META, asof=date(2026, 7, 1))
    assert feats["tax_assessed_log"] == pytest.approx(math.log(500000))
    assert feats["list_to_assessed_ratio"] == pytest.approx(2000 / 500000)
    assert feats["assessed_ratio_present"] == 1.0


def test_ext_tax_assessed_low_value_uses_floor():
    """Tax assessed value below 10000 → log uses 10000 floor."""
    row = dict(ROW, tax_assessed_value=5000, rent=2000)
    feats = compute_features(row, BASE_META, asof=date(2026, 7, 1))
    assert feats["tax_assessed_log"] == pytest.approx(math.log(10000))
    assert feats["list_to_assessed_ratio"] == pytest.approx(2000 / 5000)
    assert feats["assessed_ratio_present"] == 1.0


def test_ext_tax_assessed_no_list_price():
    """Tax assessed value present but no list price → ratio stays sentinel."""
    row = dict(ROW, tax_assessed_value=500000)
    feats = compute_features(row, BASE_META, asof=date(2026, 7, 1))
    assert feats["tax_assessed_log"] == pytest.approx(math.log(500000))
    assert feats["list_to_assessed_ratio"] == 1.0
    assert feats["assessed_ratio_present"] == 0.0


def test_ext_assessed_ratio_present_flips():
    """assessed_ratio_present is 1.0 only when both values are real."""
    # Both present → present = 1.0
    row = dict(ROW, tax_assessed_value=400000, rent=1800)
    feats = compute_features(row, BASE_META)
    assert feats["assessed_ratio_present"] == 1.0
    assert feats["list_to_assessed_ratio"] != 1.0

    # Only assessed, no rent → present = 0.0
    row_no_rent = dict(ROW, tax_assessed_value=400000)
    feats_no = compute_features(row_no_rent, BASE_META)
    assert feats_no["assessed_ratio_present"] == 0.0
    assert feats_no["list_to_assessed_ratio"] == 1.0
