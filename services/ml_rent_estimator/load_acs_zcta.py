"""Load ACS 5-year ZCTA demographics into the zcta_demographics table.

Sources (in priority order):
  1. US Census Bureau API: https://api.census.gov/data/{year}/acs/acs5
  2. Fallback CSV: https://michaelminn.net/tutorials/data/2019-2023-acs-zcta.csv

Variables fetched:
  B19013_001E  median household income
  B25064_001E  median gross rent
  B25077_001E  median home value
  B01003_001E  population
  B25002_001E  total housing units
  B25002_003E  vacant housing units

Two modes:
  --tsv       write "zcta\tacs_year\tincome\trent\tvalue\tpop\tvacant\ttotal" to stdout
              (pipe into:  psql -c "\\copy zcta_demographics FROM STDIN")
  (default)   fetch and upsert directly via DATABASE_URL

Usage:
  python load_acs_zcta.py --tsv > acs.tsv
  DATABASE_URL=... python load_acs_zcta.py
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import urllib.request
from typing import Any

VARIABLES = [
    "B19013_001E",  # median household income
    "B25064_001E",  # median gross rent
    "B25077_001E",  # median home value
    "B01003_001E",  # population
    "B25002_001E",  # total housing units
    "B25002_003E",  # vacant housing units
]

# ACS sends -666666666 and similar sentinels for suppressed cells.


def _null_sentinels(v: Any) -> float | None:
    if v is None:
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return n


def fetch(year: int, api_key: str) -> list[dict[str, Any]]:
    """Fetch ACS data from the Census API. Returns list of dicts with
    zcta, acs_year, and the six variable columns."""
    params = "?get=" + ",".join(VARIABLES) + "&for=zip%20code%20tabulation%20area:*"
    if api_key:
        params += f"&key={api_key}"
    url = f"https://api.census.gov/data/{year}/acs/acs5{params}"
    print(f"Fetching {url}", file=sys.stderr)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode()
    if resp.headers.get("Content-Type", "").startswith("text/html"):
        raise ValueError(f"Census API returned HTML (key rejected or missing): {body[:200]}")
    raw = json.loads(body)
    header = raw[0]
    zcta_idx = header.index("zip code tabulation area")
    rows: list[dict[str, Any]] = []
    for row in raw[1:]:
        zcta = str(row[zcta_idx]).strip().zfill(5)
        if not zcta or zcta == "00000":
            continue
        entry: dict[str, Any] = {"zcta": zcta, "acs_year": year}
        for i, var in enumerate(VARIABLES):
            entry[var] = _null_sentinels(row[i])
        rows.append(entry)
    print(f"  fetched {len(rows)} ZCTA rows for {year}", file=sys.stderr)
    return rows


def fetch_fallback_csv() -> list[dict[str, Any]]:
    """Fetch ACS data from the MichaelMinn pre-processed CSV (no key needed)."""
    url = "https://michaelminn.net/tutorials/data/2019-2023-acs-zcta.csv"
    print(f"Fallback: downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode()

    reader = csv.DictReader(io.StringIO(raw))
    rows: list[dict[str, Any]] = []
    for row in reader:
        geoid = row.get("GEOIDFQ", "")
        m = re.search(r"US(\d{5})$", geoid)
        if not m:
            continue
        zcta = m.group(1)
        income = _null_sentinels(row.get("Median_Household_Income"))
        rent = _null_sentinels(row.get("Median_Monthly_Rent"))
        home_val = _null_sentinels(row.get("Median_Home_Value"))
        pop = _null_sentinels(row.get("Total_Population"))
        total_units = _null_sentinels(row.get("Total_Housing_Units"))
        pct_vacant = _null_sentinels(row.get("Percent_Vacant_Units"))
        vacant = None
        if total_units is not None and pct_vacant is not None:
            vacant = round(total_units * pct_vacant / 100.0)
        rows.append({
            "zcta": zcta,
            "acs_year": 2023,
            "B19013_001E": income,
            "B25064_001E": rent,
            "B25077_001E": home_val,
            "B01003_001E": pop,
            "B25002_001E": total_units,
            "B25002_003E": vacant,
        })
    print(f"  loaded {len(rows)} ZCTA rows from fallback CSV", file=sys.stderr)
    return rows


def main() -> None:
    api_key = os.environ.get("CENSUS_API_KEY")
    rows: list[dict[str, Any]] = []

    # Tier 1: Try API with key (if available)
    if api_key:
        for year in (2024, 2023):
            try:
                rows = fetch(year, api_key)
                if rows:
                    break
            except Exception as exc:
                print(f"  {year} keyed failed: {exc}", file=sys.stderr)

    # Tier 2: Try API without key (Census free tier: 500 req/day/IP)
    if not rows:
        for year in (2024, 2023):
            try:
                rows = fetch(year, "")
                if rows:
                    break
            except Exception as exc:
                print(f"  {year} keyless failed: {exc}", file=sys.stderr)

    # Tier 3: Fallback pre-processed CSV
    if not rows:
        try:
            rows = fetch_fallback_csv()
        except Exception as exc:
            print(f"ERROR: fallback CSV also failed: {exc}", file=sys.stderr)
            sys.exit(1)

    if not rows:
        print("ERROR: could not fetch ACS data from any source", file=sys.stderr)
        sys.exit(1)

    if "--tsv" in sys.argv:
        def _tsv(v: Any) -> str:
            return r"\N" if v is None else str(v)
        w = sys.stdout
        for r in rows:
            w.write(
                f"{r['zcta']}\t{r['acs_year']}\t"
                f"{_tsv(r['B19013_001E'])}\t{_tsv(r['B25064_001E'])}\t"
                f"{_tsv(r['B25077_001E'])}\t{_tsv(r['B01003_001E'])}\t"
                f"{_tsv(r['B25002_003E'])}\t{_tsv(r['B25002_001E'])}\n"
            )
        print(f"emitted {len(rows)} rows", file=sys.stderr)
        return

    import psycopg2
    from psycopg2.extras import execute_values

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO zcta_demographics
                       (zcta, acs_year, median_hh_income, median_gross_rent,
                        median_home_value, population, vacant_units, total_units)
                   VALUES %s
                   ON CONFLICT (zcta, acs_year) DO UPDATE SET
                       median_hh_income  = COALESCE(EXCLUDED.median_hh_income, zcta_demographics.median_hh_income),
                       median_gross_rent = COALESCE(EXCLUDED.median_gross_rent, zcta_demographics.median_gross_rent),
                       median_home_value = COALESCE(EXCLUDED.median_home_value, zcta_demographics.median_home_value),
                       population        = COALESCE(EXCLUDED.population, zcta_demographics.population),
                       vacant_units      = COALESCE(EXCLUDED.vacant_units, zcta_demographics.vacant_units),
                       total_units       = COALESCE(EXCLUDED.total_units, zcta_demographics.total_units)""",
                [
                    (
                        r["zcta"], r["acs_year"],
                        r["B19013_001E"], r["B25064_001E"],
                        r["B25077_001E"], r["B01003_001E"],
                        r["B25002_003E"], r["B25002_001E"],
                    )
                    for r in rows
                ],
                page_size=5000,
            )
        conn.commit()
        print(f"upserted {len(rows)} rows", file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
