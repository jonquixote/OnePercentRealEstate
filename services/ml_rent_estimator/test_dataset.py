"""Unit tests for the feature builder. These cover only pure-python feature
logic (no lightgbm), so they run anywhere pandas/numpy are present:

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_dataset.py -v
"""
import math

import pytest

from ml_rent_estimator.dataset import (
    FEATURE_NAMES,
    compute_features,
    vector_from_features,
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
