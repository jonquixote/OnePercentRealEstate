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
from datetime import date as _date_type
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
    # --- rent model v2 P1: hyperlocal location (append-only) ---
    "tract_te",             # shrinkage TE at census-tract level
    "h3_te",                # shrinkage TE at the finest available H3 hex
    "local_rent_psf_log",   # local rental $/sqft surface (H3 res-8 + ring-1)
    "local_sold_psf_log",   # local sold $/sqft surface (H3 res-8 + ring-1)
    "local_obs_log",        # log1p obs behind the finest TE level (trust)
    "tract_med_income_log", # ACS tract median household income
    "h3_8_obs_log",         # density at res-8 (learn when the coarse hex is thin)
    "h3_9_obs_log",         # density at res-9 (learn when the fine hex is trustworthy)
    # --- rent model v2 P2: property history (append-only) ---
    "years_since_last_sale",     # sentinel -1.0 when no sale data
    "last_sold_ppsf_log",        # log(last_sold_price/sqft), sentinel 0.0
    "last_sold_vs_local",        # ratio of last_sold_ppsf to local_sold_psf, sentinel 1.0
    "last_sold_ratio_present",   # 1.0 when ratio is from real data, 0.0 when sentinel
    "prior_rent_log",            # log(prior observed rent for same address), sentinel 0.0
    "months_since_prior_rent",   # sentinel -1.0 when no prior rent
    # --- rent model v2 P3: temporal anchors (append-only) ---
    "fmr_cagr_3yr",              # 3-year CAGR of HUD SAFMR for this (zip, beds), sentinel 0.0
    "zcta_income_growth_5yr",    # 5-year fractional growth in ZCTA median income, sentinel 0.0
    "zcta_rent_growth_5yr",      # 5-year fractional growth in ZCTA median rent, sentinel 0.0
    # --- rent model v2 ext: tax assessed value (append-only) ---
    "tax_assessed_log",          # log(max(tax_assessed_value, 10000)), sentinel 0.0 when missing
    "list_to_assessed_ratio",    # list_price / tax_assessed_value, sentinel 1.0 when missing
    "assessed_ratio_present",    # 1.0 when ratio is from real data, 0.0 when sentinel
    # --- rent model v3: data expansion signals (append-only) ---
    "zip_hpi_cagr_5yr",        # 5-year CAGR of FHFA ZIP HPI, sentinel 0.0
    "walkability_index",        # EPA National Walkability Index (1-20), sentinel 0.0
    "county_unemployment",      # BLS county unemployment rate, sentinel 0.0
    "disaster_decl_10yr",       # count of FEMA disaster declarations in county last 10yr, sentinel 0.0
    "flood_sfha",               # 1.0 if property is in SFHA flood zone, 0.0 otherwise
    "transit_stops_1km",        # count of transit stops within 1km, sentinel 0.0
    "county_crime_rate",        # violent crime rate per 100k, sentinel 0.0
]

# Minimum observation count at h3_9 before we trust its TE estimate.
# Below this threshold, the shrinkage prior (10) is too weak to suppress
# low-n noise, so we skip h3_9 entirely and fall back to h3_8.
MIN_H3_9_OBS = 15

# Missing-value floor for the local psf surface (log(0.1)); not a plausible
# real $/sqft, so LightGBM can split "no surface" cleanly.
_SENTINEL_PSF = 0.1

TRAINING_SQL = """
WITH base AS (
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
         coalesce(r.census_tract, '') AS census_tract,
         r.listing_date,
         r.address,
         -- P3: listing-time-correct HUD SAFMR (fy matching the listing year)
         h.safmr::float          AS hud_safmr,
         -- P3: HUD SAFMR from 3 fiscal years earlier for CAGR
         h3.safmr::float         AS hud_safmr_3yr_ago,
         z.median_hh_income::float  AS zcta_med_income,
         z.median_gross_rent::float AS zcta_med_rent,
         -- P3: ZCTA demographics from 5 years earlier for growth
         z5.median_hh_income::float AS zcta_med_income_5yr_ago,
         z5.median_gross_rent::float AS zcta_med_rent_5yr_ago,
         -- P2: sale history from raw_data (leakage check in compute_features)
         CASE WHEN (r.raw_data->>'last_sold_price') IS NOT NULL
              AND regexp_replace(r.raw_data->>'last_sold_price', '[^0-9.]', '', 'g') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN regexp_replace(r.raw_data->>'last_sold_price', '[^0-9.]', '', 'g')::float
         END AS last_sold_price,
         (r.raw_data->>'last_sold_date')::date AS last_sold_date,
         -- ext: tax assessed value from raw_data
         CASE WHEN (r.raw_data->>'tax_assessed_value') IS NOT NULL
              AND regexp_replace(r.raw_data->>'tax_assessed_value', '[^0-9.]', '', 'g') ~ '^[0-9]+(\\.[0-9]+)?$'
              THEN regexp_replace(r.raw_data->>'tax_assessed_value', '[^0-9.]', '', 'g')::float
          END AS tax_assessed_value,
          -- v3 data expansion signals
          COALESCE(r.flood_sfha, 0) AS flood_sfha,
          COALESCE(r.transit_stops_1km, 0) AS transit_stops_1km,
          r.fips_code
  FROM rental_listings r
  -- P3: listing-time-correct HUD join (fiscal year matching listing year).
  -- HUD FY runs Oct→Sep, so a listing in Jan 2026 is FY2026; listing in
  -- Nov 2025 is also FY2026. We approximate: fy = listing_year when
  -- listing_month >= 10 use fy+1, else fy = listing_year. Simplified:
  -- fy = EXTRACT(YEAR FROM listing_date) + CASE WHEN EXTRACT(MONTH ...) >= 10 THEN 1 ELSE 0 END.
  -- But since our data is short (2026 only), the simpler approach of using
  -- the latest fy <= listing year suffices.
  LEFT JOIN LATERAL (
      SELECT safmr FROM hud_safmr
      WHERE zip_code = r.zip_code
        AND bedrooms = LEAST(GREATEST(coalesce(r.bedrooms, 2)::int, 0), 4)
        AND fy <= EXTRACT(YEAR FROM coalesce(r.listing_date, CURRENT_DATE))::int
      ORDER BY fy DESC LIMIT 1
  ) h ON true
  -- P3: HUD SAFMR from 3 years before the listing for CAGR computation
  LEFT JOIN LATERAL (
      SELECT safmr FROM hud_safmr
      WHERE zip_code = r.zip_code
        AND bedrooms = LEAST(GREATEST(coalesce(r.bedrooms, 2)::int, 0), 4)
        AND fy <= (EXTRACT(YEAR FROM coalesce(r.listing_date, CURRENT_DATE))::int - 3)
      ORDER BY fy DESC LIMIT 1
  ) h3 ON true
  LEFT JOIN LATERAL (
      SELECT median_hh_income, median_gross_rent FROM zcta_demographics
      WHERE zcta = r.zip_code
        AND acs_year <= EXTRACT(YEAR FROM coalesce(r.listing_date, CURRENT_DATE))::int
      ORDER BY acs_year DESC LIMIT 1
  ) z ON true
  -- P3: ZCTA demographics from ~5 years before the listing for growth
  LEFT JOIN LATERAL (
      SELECT median_hh_income, median_gross_rent FROM zcta_demographics
      WHERE zcta = r.zip_code
        AND acs_year <= (EXTRACT(YEAR FROM coalesce(r.listing_date, CURRENT_DATE))::int - 4)
      ORDER BY acs_year DESC LIMIT 1
  ) z5 ON true
  WHERE r.price BETWEEN 300 AND 20000
  ORDER BY r.address, r.listing_date, r.created_at DESC
)
SELECT b.*,
       -- P2: prior rent from the same normalized address (LAG partition).
       -- Address normalization MUST match market_stats.ADDRESS_NORM_SQL.
       LAG(b.rent) OVER (
         PARTITION BY lower(regexp_replace(trim(b.address), '\\s+', ' ', 'g'))
         ORDER BY b.listing_date
       ) AS prior_rent,
       LAG(b.listing_date) OVER (
         PARTITION BY lower(regexp_replace(trim(b.address), '\\s+', ' ', 'g'))
         ORDER BY b.listing_date
       ) AS prior_rent_date
FROM base b
"""


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
                 tract_income: Optional[dict] = None, conn=None) -> dict:
    """Fit all encoders on the TRAIN frame only. Returns the metadata dict
    that predict-time feature building consumes.

    market_stats: {h3_8: [rent_psf, sold_psf, n_rent, n_sold]} (collapsed
      across months by the caller). tract_income: {geoid: median_hh_income}.
    conn: optional psycopg2 connection for v3 data-expansion lookups.
    Both are baked into meta so serving reconstructs identical features.
    """
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

    # --- v3: data expansion lookups (require DB connection) ---
    hpi_cagr = {}
    tract_walk = {}
    county_unemp = {}
    county_disasters = {}
    county_crime = {}

    if conn is not None:
        with conn.cursor() as cur:
            # hpi_cagr: {zip5: float} from fhfa_zip_hpi
            cur.execute("""
                SELECT DISTINCT ON (zip5) zip5,
                       CASE WHEN hpi > 0 AND lag_hpi > 0 THEN (hpi / lag_hpi) ^ (1.0/5.0) - 1.0 ELSE 0.0 END AS cagr
                FROM (
                    SELECT zip5, hpi,
                           LAG(hpi, 5) OVER (PARTITION BY zip5 ORDER BY year) AS lag_hpi
                    FROM fhfa_zip_hpi
                ) sub
                WHERE lag_hpi IS NOT NULL AND lag_hpi > 0
            """)
            hpi_cagr = {r[0]: float(r[1]) for r in cur.fetchall()}

            # tract_walk: {geoid: float} from tract_walkability view
            cur.execute("SELECT geoid, natwalkind FROM tract_walkability WHERE natwalkind IS NOT NULL")
            tract_walk = {r[0]: float(r[1]) for r in cur.fetchall()}

            # county_unemp: {fips: float} from bls_county_laus (latest per county)
            cur.execute("""
                SELECT DISTINCT ON (fips) fips, unemployment_rate
                FROM bls_county_laus WHERE unemployment_rate IS NOT NULL
                ORDER BY fips, period DESC
            """)
            county_unemp = {r[0]: float(r[1]) for r in cur.fetchall()}

            # county_disasters: {fips: float} from fema_disasters (last 10yr count)
            cur.execute("""
                SELECT fips, SUM(declarations)::float
                FROM fema_disasters WHERE fy >= EXTRACT(YEAR FROM now()) - 10
                GROUP BY fips
            """)
            county_disasters = {r[0]: float(r[1]) for r in cur.fetchall()}

            # county_crime: {fips: float} from crime_county (latest year)
            cur.execute("""
                SELECT DISTINCT ON (fips) fips, violent_per_100k
                FROM crime_county WHERE violent_per_100k IS NOT NULL AND agencies_reporting >= 2
                ORDER BY fips, year DESC
            """)
            county_crime = {r[0]: float(r[1]) for r in cur.fetchall()}

    return {
        "feature_names": FEATURE_NAMES,
        "global_mean_log": global_mean_log,
        "zip_te": zip_te,
        "ptype_map": ptype_map,
        "hud_beds_median": hud_beds_median,
        "sqft_median_by_beds": sqft_median_by_beds,
        "zcta_income_global_median": zcta_income_global_median,
        "zcta_rent_global_median": zcta_rent_global_median,
        # P1 hyperlocal (large — train_v1 splits these into a sidecar file):
        "te_stats": te_stats,
        "local_by_hex": local_by_hex,
        "tract_income": tract_income or {},
        "global_rent_psf": global_rent_psf,
        "global_sold_psf": global_sold_psf,
        # v3 data expansion lookups:
        "hpi_cagr": hpi_cagr,
        "tract_walk": tract_walk,
        "county_unemp": county_unemp,
        "county_disasters": county_disasters,
        "county_crime": county_crime,
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
    row_val: Optional[float], meta: dict, global_key: str, hardcoded: float
) -> float:
    if row_val is not None and row_val == row_val and row_val > 0:
        return float(row_val)
    return float(meta.get(global_key, hardcoded))

# --- rent model v2 P2 helpers: date parsing ---

def _parse_date(val: Any) -> Optional[_date_type]:
    """Robustly parse a date from various inputs (date, datetime, str).
    Returns None on failure — never raises."""
    if val is None:
        return None
    if hasattr(val, "date"):
        try:
            return val.date()
        except Exception:
            pass
    if isinstance(val, _date_type) and type(val) is _date_type:
        return val
    try:
        # standard ISO format parsing
        return _date_type.fromisoformat(str(val)[:10])
    except (ValueError, TypeError, AttributeError):
        return None


# --- rent model v2 P3 helpers: trajectory features ---

def _fmr_cagr(current: Optional[float], old: Optional[float], years: float = 3.0) -> float:
    """Compound annual growth rate between two HUD SAFMR values over `years`.
    Returns 0.0 sentinel if either value is missing or non-positive."""
    if current is None or old is None or current <= 0 or old <= 0:
        return 0.0
    return (current / old) ** (1.0 / years) - 1.0


def _growth_frac(current: Optional[float], old: Optional[float]) -> float:
    """Fractional growth (current - old) / old. Returns 0.0 sentinel if
    either value is missing or old is non-positive."""
    if current is None or old is None or old <= 0:
        return 0.0
    return (current - old) / old


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
    h9_te = _shrink(f_n, f_ls, h8_te, 10.0) if f_n >= MIN_H3_9_OBS else h8_te

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
        num(row.get("zcta_med_income"), None),
        meta, "zcta_income_global_median", 60000.0,
    )
    zcta_rent = _zcta_anchor(
        num(row.get("zcta_med_rent"), None),
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

    # v3: lookup keys for data expansion features
    zip5 = str(row.get("zip") or "")[:5]
    county_fips = str(row.get("fips_code") or tract_key[:5] or "")

    cas = _te_cascade(zip_te, tract_key, h3_8, h3_9, meta.get("te_stats", {}), meta["global_mean_log"])
    rent_psf, sold_psf = _local_surface(h3_8, meta.get("local_by_hex", {}), meta)

    tract_income = meta.get("tract_income", {}).get(tract_key)
    if not tract_income or tract_income != tract_income:
        tract_income = zcta_income  # fall back to the (coarser) ZCTA income

    # --- P2 property history ---
    years_since_last_sale = -1.0   # sentinel: no sale data
    last_sold_ppsf_log = 0.0       # sentinel
    last_sold_vs_local = 1.0       # sentinel (neutral ratio)
    last_sold_ratio_present = 0.0  # binary: 0 = sentinel ratio

    last_sold_price_val = num(row.get("last_sold_price"), None)
    last_sold_date_raw = row.get("last_sold_date")

    if last_sold_price_val is not None and last_sold_price_val > 0:
        # Parse date, check leakage (sale must be before reference date)
        sd = _parse_date(last_sold_date_raw)
        ref = _parse_date(asof)
        sale_valid = True
        if sd is not None and ref is not None and sd >= ref:
            sale_valid = False  # leakage: sale at or after listing

        if sale_valid:
            if sd is not None:
                ref_d = ref if ref is not None else _date_type.today()
                delta_days = (ref_d - sd).days
                if delta_days >= 0:
                    years_since_last_sale = delta_days / 365.25

            sale_sqft = max(sqft, 100.0)
            ppsf = last_sold_price_val / sale_sqft
            last_sold_ppsf_log = math.log(max(ppsf, 0.01))

            # Ratio to local surface — only meaningful when local surface is
            # real data, not the global fallback.
            global_sold = float(meta.get("global_sold_psf", 250.0))
            if sold_psf != global_sold:
                last_sold_vs_local = ppsf / max(sold_psf, 0.01)
                last_sold_ratio_present = 1.0

    # Prior rent (training: from LAG(); serving: from _rent_memory cache)
    prior_rent_log_val = 0.0       # sentinel
    months_since_prior_rent_val = -1.0  # sentinel

    prior_rent_val = num(row.get("prior_rent"), None)
    prior_rent_date_raw = row.get("prior_rent_date")

    if prior_rent_val is not None and prior_rent_val > 0:
        prior_rent_log_val = math.log(max(prior_rent_val, 100.0))
        pd_ = _parse_date(prior_rent_date_raw)
        if pd_ is not None:
            ref_d = _parse_date(asof) or _date_type.today()
            delta_days = (ref_d - pd_).days
            if delta_days >= 0:
                months_since_prior_rent_val = delta_days / 30.44

    # --- ext: tax assessed value ---
    tax_assessed_log = 0.0         # sentinel: missing
    list_to_assessed_ratio = 1.0   # sentinel: neutral ratio
    assessed_ratio_present = 0.0   # binary: 0 = sentinel ratio

    tax_assessed_val = num(row.get("tax_assessed_value"), None)
    list_price = num(row.get("rent"), None)  # in training, rent is the list price

    if tax_assessed_val is not None and tax_assessed_val > 0:
        tax_assessed_log = math.log(max(tax_assessed_val, 10000.0))
        if list_price is not None and list_price > 0:
            list_to_assessed_ratio = list_price / max(tax_assessed_val, 1.0)
            assessed_ratio_present = 1.0

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
        # --- P1 hyperlocal ---
        "tract_te": cas["tract_te"],
        "h3_te": cas["h3_te"],
        "local_rent_psf_log": math.log(max(rent_psf, _SENTINEL_PSF)),
        "local_sold_psf_log": math.log(max(sold_psf, 1.0)),
        "local_obs_log": math.log1p(cas["local_obs"]),
        "tract_med_income_log": math.log(max(float(tract_income), 10000.0)),
        "h3_8_obs_log": math.log1p(cas["h3_8_obs"]),
        "h3_9_obs_log": math.log1p(cas["h3_9_obs"]),
        # --- P2 property history ---
        "years_since_last_sale": years_since_last_sale,
        "last_sold_ppsf_log": last_sold_ppsf_log,
        "last_sold_vs_local": last_sold_vs_local,
        "last_sold_ratio_present": last_sold_ratio_present,
        "prior_rent_log": prior_rent_log_val,
        "months_since_prior_rent": months_since_prior_rent_val,
        # --- P3 temporal anchors ---
        "fmr_cagr_3yr": _fmr_cagr(
            num(row.get("hud_safmr"), None),
            num(row.get("hud_safmr_3yr_ago"), None),
        ),
        "zcta_income_growth_5yr": _growth_frac(
            zcta_income,
            num(row.get("zcta_med_income_5yr_ago"), None),
        ),
        "zcta_rent_growth_5yr": _growth_frac(
            zcta_rent,
            num(row.get("zcta_med_rent_5yr_ago"), None),
        ),
        # --- ext: tax assessed value ---
        "tax_assessed_log": tax_assessed_log,
        "list_to_assessed_ratio": list_to_assessed_ratio,
        "assessed_ratio_present": assessed_ratio_present,
        # --- v3: data expansion signals ---
        "zip_hpi_cagr_5yr": meta.get("hpi_cagr", {}).get(zip5, 0.0),
        "walkability_index": meta.get("tract_walk", {}).get(tract_key, 0.0),
        "county_unemployment": meta.get("county_unemp", {}).get(county_fips, 0.0),
        "disaster_decl_10yr": meta.get("county_disasters", {}).get(county_fips, 0.0),
        "flood_sfha": num(row.get("flood_sfha"), 0.0),
        "transit_stops_1km": num(row.get("transit_stops_1km"), 0.0),
        "county_crime_rate": meta.get("county_crime", {}).get(county_fips, 0.0),
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
    TRAINING_SQL column names. Returns (X ndarray, y ndarray|None, w ndarray).

    P2+: passes listing_date as asof so date-relative features (sale age,
    prior-rent age) are relative to the training row, not today.
    
    P3: replaces the global recency weight with a metro-aware half-life derived
    from available growth anchors, falling back to 365 days."""
    import numpy as np
    import pandas as pd

    rows = df.to_dict("records")
    X = np.asarray(
        [build_feature_row(r, meta, asof=r.get("listing_date")) for r in rows],
        dtype=float,
    )
    y = np.log(df["rent"].to_numpy(dtype=float)) if "rent" in df else None
    if "listing_date" in df:
        age_days = (df["listing_date"].max() - df["listing_date"]).dt.days.to_numpy(dtype=float)
        if "hud_safmr" in df and "hud_safmr_3yr_ago" in df:
            current = pd.to_numeric(df["hud_safmr"], errors="coerce").to_numpy(dtype=float)
            old = pd.to_numeric(df["hud_safmr_3yr_ago"], errors="coerce").to_numpy(dtype=float)
            valid = (current > 0) & (old > 0)
            cagr = np.zeros_like(current)
            cagr[valid] = (current[valid] / old[valid]) ** (1.0 / 3.0) - 1.0
            decay_days = np.where(valid, 365.0 / (1.0 + 5.0 * np.maximum(cagr, 0.0)), 365.0)
        else:
            decay_days = 365.0
        w = np.exp(-age_days / decay_days)
    else:
        w = np.ones(len(df))
    return X, y, w
