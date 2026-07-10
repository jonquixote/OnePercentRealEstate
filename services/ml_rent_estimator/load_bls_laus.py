"""Load BLS LAUS county unemployment rates into the bls_county_laus table.

Source: https://api.bls.gov/publicAPI/v2/timeseries/data/
Series id pattern: LAUCN{fips}0000000003 (unemployment rate, seasonally adjusted)
API key required: env BLS_API_KEY (free at data.bls.gov/registrationEngine)

Rate limit: 500 requests/day. 50 series per batch → ~65 requests covers ~3,200 counties.
Safe to resume: upsert makes re-runs idempotent.

Usage:
  BLS_API_KEY=... DATABASE_URL=... python load_bls_laus.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import date
from typing import Any

import requests

API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
BATCH_SIZE = 50
TIMEOUT = 30
# BLS uses M01-M12 for months; map to day-of-month
MONTH_MAP = {f"M{m:02d}": m for m in range(1, 13)}


def get_county_fips() -> list[str]:
    """Get distinct 5-digit county FIPS from census_tracts."""
    import psycopg2

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT left(geoid, 5) FROM census_tracts")
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def build_series_ids(fips_list: list[str]) -> list[str]:
    return [f"LAUCN{fips}0000000003" for fips in fips_list]


def fetch_batch(series_ids: list[str], api_key: str, start_year: int, end_year: int) -> dict[str, list[dict[str, Any]]]:
    """Fetch a batch of series from BLS API v2.

    Returns dict mapping series_id -> list of {period: date, value: float}.
    """
    payload = {
        "seriesid": series_ids,
        "startyear": str(start_year),
        "endyear": str(end_year),
        "registrationkey": api_key,
    }
    resp = requests.post(API_URL, json=payload, timeout=TIMEOUT)
    resp.raise_for_status()
    body = resp.json()

    if body.get("status") == "REQUEST_NOT_PROCESSED":
        msg = body.get("message", [])
        print(f"  BLS daily cap hit: {msg}", file=sys.stderr)
        return {}

    if body.get("status") != "REQUEST_SUCCEEDED":
        print(f"  BLS request failed: {body.get('status')}", file=sys.stderr)
        return {}

    results: dict[str, list[dict[str, Any]]] = {}
    for series in body.get("Results", {}).get("series", []):
        sid = series.get("seriesID", "")
        datapoints: list[dict[str, Any]] = []
        for dp in series.get("data", []):
            period_str = dp.get("period", "")
            month = MONTH_MAP.get(period_str)
            if month is None:
                continue
            year = int(dp["year"])
            try:
                value = float(dp["value"])
            except (TypeError, ValueError):
                continue
            datapoints.append({"period": date(year, month, 1), "value": value})
        results[sid] = datapoints
    return results


def parse_fips_from_series_id(sid: str) -> str:
    """Extract 5-digit FIPS from LAUCN{fips}0000000003."""
    return sid[5:10]


def upsert(rows: list[tuple[str, str, float]]) -> int:
    """Upsert (fips, period, unemployment_rate) rows."""
    import psycopg2
    from psycopg2.extras import execute_values

    if not rows:
        return 0

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO bls_county_laus (fips, period, unemployment_rate)
                   VALUES %s
                   ON CONFLICT (fips, period)
                   DO UPDATE SET unemployment_rate = EXCLUDED.unemployment_rate""",
                rows,
                page_size=5000,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def main() -> None:
    api_key = os.environ.get("BLS_API_KEY", "")
    if not api_key:
        print("ERROR: BLS_API_KEY env var required", file=sys.stderr)
        sys.exit(1)

    fips_list = get_county_fips()
    print(f"Counties found: {len(fips_list)}", file=sys.stderr)

    series_ids = build_series_ids(fips_list)
    today = date.today()
    end_year = today.year
    start_year = end_year - 2  # trailing 24 months

    all_rows: list[tuple[str, str, float]] = []
    capped = False

    for i in range(0, len(series_ids), BATCH_SIZE):
        batch = series_ids[i : i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        total_batches = (len(series_ids) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"  batch {batch_num}/{total_batches} ({len(batch)} series)", file=sys.stderr)

        data = fetch_batch(batch, api_key, start_year, end_year)
        if not data:
            # REQUEST_NOT_PROCESSED — daily cap hit
            capped = True
            break

        for sid, points in data.items():
            fips = parse_fips_from_series_id(sid)
            for pt in points:
                all_rows.append((fips, pt["period"].isoformat(), pt["value"]))

        # polite delay between requests
        if i + BATCH_SIZE < len(series_ids):
            time.sleep(0.5)

    n = upsert(all_rows)
    print(json.dumps({"done": True, "rows": n, "capped": capped}))


if __name__ == "__main__":
    main()
