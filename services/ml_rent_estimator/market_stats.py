"""Nightly refresh of the hyperlocal market-stats surface (rent model v2 P1)
and the durable address rent memory (P2).

H3 indexing is done in Python (the prod Postgres has no h3 extension and we
will not add one for this). Called by services/ml/main.py:/ops/refresh-market-stats,
which the ml-scheduler triggers nightly.

Two maintained artifacts, one pass:
  - h3_market_stats: median rent/sold $/sqft per (H3 res-8 hex, month).
  - address_rent_history (P2): latest observed rent per normalized address.

`stat_month` is the month the data is FROM. The reader enforces leakage
rules (training: strictly-prior month; serving: latest complete month).
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("ml.market_stats")

H3_RES = 8
# How many trailing months of source data to (re)aggregate each run. Cheap
# to recompute; keeps late-arriving rows correct.
LOOKBACK_MONTHS = 4

# Address normalization — defined ONCE here and mirrored verbatim in SQL
# (address_rent_history upsert + training LAG partition). Never refactor:
# any divergence silently breaks the prior-rent join. See spec §Address
# normalization freeze.
ADDRESS_NORM_SQL = "lower(regexp_replace(trim(address), '\\s+', ' ', 'g'))"


def _h3_col(df, lat_col: str, lng_col: str):
    """Vectorized-ish H3 res-8 assignment for a frame; returns a string
    Series (None where lat/lng missing)."""
    import h3
    import pandas as pd

    def cell(row) -> Any:
        lat, lng = row[lat_col], row[lng_col]
        if lat is None or lng is None or lat != lat or lng != lng:
            return None
        try:
            return h3.latlng_to_cell(float(lat), float(lng), H3_RES)
        except (ValueError, TypeError):
            return None

    if df.empty:
        return pd.Series([], dtype="object")
    return df.apply(cell, axis=1)


def refresh_h3_market_stats(conn) -> int:
    """Recompute h3_market_stats for the trailing LOOKBACK_MONTHS. Returns
    the number of (hex, month) rows upserted."""
    import pandas as pd

    rentals = pd.read_sql(
        """
        SELECT latitude AS lat, longitude AS lng, price, sqft, listing_date
        FROM rental_listings
        WHERE listing_date >= (date_trunc('month', now()) - interval '%s months')
          AND price BETWEEN 300 AND 20000 AND sqft > 100
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        """ % LOOKBACK_MONTHS,
        conn,
        parse_dates=["listing_date"],
    )
    solds = pd.read_sql(
        """
        SELECT latitude AS lat, longitude AS lng, sold_price, sqft, sold_date
        FROM sold_listings
        WHERE sold_date >= (date_trunc('month', now()) - interval '%s months')::date
          AND sold_date <= now()
          AND sold_price > 0 AND sqft > 100
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        """ % LOOKBACK_MONTHS,
        conn,
        parse_dates=["sold_date"],
    )

    frames = {}
    if not rentals.empty:
        rentals = rentals.assign(
            h3_8=_h3_col(rentals, "lat", "lng"),
            month=rentals["listing_date"].dt.to_period("M").dt.to_timestamp().dt.date,
            psf=rentals["price"].astype(float) / rentals["sqft"].astype(float),
        ).dropna(subset=["h3_8"])
        rg = rentals.groupby(["h3_8", "month"])["psf"].agg(med_rent_psf="median", n_rent="count")
        frames["rent"] = rg
    if not solds.empty:
        solds = solds.assign(
            h3_8=_h3_col(solds, "lat", "lng"),
            month=solds["sold_date"].dt.to_period("M").dt.to_timestamp().dt.date,
            psf=solds["sold_price"].astype(float) / solds["sqft"].astype(float),
        ).dropna(subset=["h3_8"])
        sg = solds.groupby(["h3_8", "month"])["psf"].agg(med_sold_psf="median", n_sold="count")
        frames["sold"] = sg

    if not frames:
        log.warning("market stats: no source rows in lookback window")
        return 0

    merged = None
    for g in frames.values():
        merged = g if merged is None else merged.join(g, how="outer")
    merged = merged.reset_index()
    for col, default in (("med_rent_psf", None), ("n_rent", 0), ("med_sold_psf", None), ("n_sold", 0)):
        if col not in merged:
            merged[col] = default
    merged[["n_rent", "n_sold"]] = merged[["n_rent", "n_sold"]].fillna(0).astype(int)

    rows = [
        (
            r.h3_8, r.month,
            None if r.med_rent_psf != r.med_rent_psf else float(r.med_rent_psf), int(r.n_rent),
            None if r.med_sold_psf != r.med_sold_psf else float(r.med_sold_psf), int(r.n_sold),
        )
        for r in merged.itertuples()
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO h3_market_stats (h3_8, stat_month, med_rent_psf, n_rent, med_sold_psf, n_sold)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (h3_8, stat_month) DO UPDATE
              SET med_rent_psf = EXCLUDED.med_rent_psf, n_rent = EXCLUDED.n_rent,
                  med_sold_psf = EXCLUDED.med_sold_psf, n_sold = EXCLUDED.n_sold
            """,
            rows,
        )
    conn.commit()
    log.info("market stats: upserted %d (hex, month) rows", len(rows))
    return len(rows)


def refresh_address_rent_history(conn) -> int:
    """Upsert the latest observed rent per normalized address (P2 durable
    rent memory). Returns rows affected (approximate — reports source rows)."""
    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO address_rent_history AS h (address_norm, zip_code, last_rent, last_rent_date)
            SELECT DISTINCT ON ({ADDRESS_NORM_SQL})
                   {ADDRESS_NORM_SQL}, zip_code, price, listing_date
            FROM rental_listings
            WHERE price BETWEEN 300 AND 20000 AND address IS NOT NULL AND listing_date IS NOT NULL
            ORDER BY {ADDRESS_NORM_SQL}, listing_date DESC
            ON CONFLICT (address_norm) DO UPDATE
              SET last_rent = EXCLUDED.last_rent,
                  last_rent_date = EXCLUDED.last_rent_date,
                  obs_count = h.obs_count + 1,
                  zip_code = EXCLUDED.zip_code
            WHERE EXCLUDED.last_rent_date > h.last_rent_date
            """
        )
        affected = cur.rowcount
    conn.commit()
    log.info("address_rent_history: %d rows upserted", affected)
    return affected


def refresh(conn) -> dict:
    """Run both refreshes. Each is independent — one failing does not abort
    the other (address_rent_history only exists after the P2 migration)."""
    out: dict[str, Any] = {}
    out["h3_rows"] = refresh_h3_market_stats(conn)
    try:
        out["addr_rows"] = refresh_address_rent_history(conn)
    except Exception as exc:  # table may not exist yet (pre-P2)
        conn.rollback()
        out["addr_error"] = str(exc)[:200]
        log.warning("address_rent_history refresh skipped: %s", exc)
    return out


def main() -> None:
    import json
    import os

    import psycopg2

    logging.basicConfig(level="INFO", format='{"level":"%(levelname)s","msg":"%(message)s","service":"ml.market_stats"}')
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        result = refresh(conn)
    finally:
        conn.close()
    print(json.dumps({"done": True, **result}), flush=True)


if __name__ == "__main__":
    main()
