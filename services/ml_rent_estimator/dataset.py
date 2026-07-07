"""Dataset + feature building for rent model v1.

One module owns the feature definition; train_v1.py and the serving path
both import from here so train/predict feature drift is impossible.

Feature vector (order = FEATURE_NAMES):
  beds, baths, sqft_log, year_built, lot_sqft_log, hoa_fee,
  lat, lng, ptype_code, zip_te, hud_anchor_log

Target: log(rent). Encoders (fit on TRAIN rows only, persisted in
metadata.json): property_type -> int code, zip -> smoothed target encoding,
HUD SAFMR per (zip, beds) with per-beds global median fallback.
"""
from __future__ import annotations

import math
from typing import Any, Optional

FEATURE_NAMES = [
    "beds",
    "baths",
    "sqft_log",
    "year_built",
    "lot_sqft_log",
    "hoa_fee",
    "lat",
    "lng",
    "ptype_code",
    "zip_te",
    "hud_anchor_log",
    "zcta_med_income_log",
    "zcta_med_rent_log",
]

TRAINING_SQL = """
SELECT DISTINCT ON (r.address, r.listing_date)
       ('x' || substr(md5(r.address), 1, 8))::bit(32)::int % 10 AS split_bucket,
       r.price::float          AS rent,
       r.bedrooms::float       AS beds,
       r.bathrooms::float      AS baths,
       r.sqft::float           AS sqft,
       r.year_built::float     AS year_built,
       r.lot_sqft::float       AS lot_sqft,
       r.hoa_fee::float        AS hoa_fee,
       r.latitude::float       AS lat,
       r.longitude::float      AS lng,
       upper(coalesce(r.property_type, 'UNKNOWN')) AS ptype,
       coalesce(r.zip_code, '') AS zip,
       upper(coalesce(r.state, '')) AS state,
       r.listing_date,
        h.safmr::float          AS hud_safmr,
        z.median_hh_income::float  AS zcta_med_income,
        z.median_gross_rent::float AS zcta_med_rent
FROM rental_listings r
LEFT JOIN (
    SELECT DISTINCT ON (zip_code, bedrooms) zip_code, bedrooms, safmr
    FROM hud_safmr
    ORDER BY zip_code, bedrooms, fy DESC
) h ON h.zip_code = r.zip_code
      AND h.bedrooms = LEAST(GREATEST(coalesce(r.bedrooms, 2)::int, 0), 4)
LEFT JOIN (
    SELECT DISTINCT ON (zcta) zcta, median_hh_income, median_gross_rent
    FROM zcta_demographics
    ORDER BY zcta, acs_year DESC
) z ON z.zcta = r.zip_code
WHERE r.price BETWEEN 300 AND 20000
ORDER BY r.address, r.listing_date, r.created_at DESC
"""


def fit_encoders(train_df) -> dict:
    """Fit all encoders on the TRAIN frame only. Returns the metadata dict
    that predict-time feature building consumes."""
    import numpy as np

    global_mean_log = float(np.log(train_df["rent"]).mean())

    # Smoothed target encoding for zip: (sum(log rent) + prior*global) / (n + prior)
    prior = 50.0
    g = train_df.groupby("zip")["rent"].agg(["count", lambda s: float(np.log(s).sum())])
    g.columns = ["n", "logsum"]
    zip_te = {
        z: (row.logsum + prior * global_mean_log) / (row.n + prior)
        for z, row in g.iterrows()
        if z
    }

    ptypes = sorted(train_df["ptype"].dropna().unique().tolist())
    ptype_map = {p: i for i, p in enumerate(ptypes)}

    # Per-beds HUD median fallback for zips missing from hud_safmr.
    hud_beds_median = {
        str(int(b)): float(m)
        for b, m in train_df.dropna(subset=["hud_safmr"])
        .assign(bcap=lambda d: d["beds"].fillna(2).clip(0, 4).astype(int))
        .groupby("bcap")["hud_safmr"]
        .median()
        .items()
    }

    # ACS global median fallback for zips missing from zcta_demographics.
    zcta_income_global_median = float(
        train_df["zcta_med_income"].dropna().median()
        if "zcta_med_income" in train_df and train_df["zcta_med_income"].notna().any()
        else 60000.0
    )
    zcta_rent_global_median = float(
        train_df["zcta_med_rent"].dropna().median()
        if "zcta_med_rent" in train_df and train_df["zcta_med_rent"].notna().any()
        else 1000.0
    )

    # Numeric imputation stats.
    sqft_median_by_beds = {
        str(int(b)): float(m)
        for b, m in train_df.dropna(subset=["sqft"])
        .assign(bcap=lambda d: d["beds"].fillna(2).clip(0, 8).astype(int))
        .groupby("bcap")["sqft"]
        .median()
        .items()
    }

    return {
        "feature_names": FEATURE_NAMES,
        "global_mean_log": global_mean_log,
        "zip_te": zip_te,
        "ptype_map": ptype_map,
        "hud_beds_median": hud_beds_median,
        "sqft_median_by_beds": sqft_median_by_beds,
        "zcta_income_global_median": zcta_income_global_median,
        "zcta_rent_global_median": zcta_rent_global_median,
    }


def _impute_sqft(beds: Optional[float], sqft: Optional[float], meta: dict) -> float:
    if sqft is not None and sqft == sqft and sqft > 0:
        return float(sqft)
    b = str(int(min(max(beds if beds is not None else 2, 0), 8)))
    return float(meta["sqft_median_by_beds"].get(b, 1200.0))


def _hud_anchor(zip_code: str, beds: Optional[float], hud_safmr: Optional[float], meta: dict) -> float:
    if hud_safmr is not None and hud_safmr == hud_safmr and hud_safmr > 0:
        return float(hud_safmr)
    b = str(int(min(max(beds if beds is not None else 2, 0), 4)))
    return float(meta["hud_beds_median"].get(b, 1500.0))


def _zcta_anchor(
    col: str, row_val: Optional[float], meta: dict, global_key: str, hardcoded: float
) -> float:
    if row_val is not None and row_val == row_val and row_val > 0:
        return float(row_val)
    return float(meta.get(global_key, hardcoded))


def build_feature_row(row: dict[str, Any], meta: dict) -> list[float]:
    """row keys: beds, baths, sqft, year_built, lot_sqft, hoa_fee, lat, lng,
    ptype, zip, hud_safmr (any may be None/NaN). Mirrors training exactly."""

    def num(v, default):
        try:
            f = float(v)
            return f if f == f else default  # NaN check
        except (TypeError, ValueError):
            return default

    beds = num(row.get("beds"), 2.0)
    baths = num(row.get("baths"), 1.0)
    sqft = _impute_sqft(beds, num(row.get("sqft"), None), meta)
    year_built = num(row.get("year_built"), 1980.0)
    lot = num(row.get("lot_sqft"), 0.0)
    hoa = num(row.get("hoa_fee"), 0.0)
    lat = num(row.get("lat"), 0.0)
    lng = num(row.get("lng"), 0.0)
    ptype_code = float(meta["ptype_map"].get(str(row.get("ptype") or "UNKNOWN").upper(), -1))
    zip_te = float(meta["zip_te"].get(str(row.get("zip") or ""), meta["global_mean_log"]))
    hud = _hud_anchor(str(row.get("zip") or ""), beds, row.get("hud_safmr"), meta)
    zcta_income = _zcta_anchor(
        "zcta_med_income", num(row.get("zcta_med_income"), None),
        meta, "zcta_income_global_median", 60000.0,
    )
    zcta_rent = _zcta_anchor(
        "zcta_med_rent", num(row.get("zcta_med_rent"), None),
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


def frame_to_matrix(df, meta: dict):
    """Vectorized version of build_feature_row for a pandas frame with the
    TRAINING_SQL column names. Returns (X ndarray, y ndarray|None, w ndarray)."""
    import numpy as np

    rows = df.to_dict("records")
    X = np.asarray([build_feature_row(r, meta) for r in rows], dtype=float)
    y = np.log(df["rent"].to_numpy(dtype=float)) if "rent" in df else None
    if "listing_date" in df:
        age_days = (df["listing_date"].max() - df["listing_date"]).dt.days.to_numpy(dtype=float)
        w = np.exp(-age_days / 180.0)
    else:
        w = np.ones(len(df))
    return X, y, w
