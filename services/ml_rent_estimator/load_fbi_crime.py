"""Load FBI Crime Data Explorer county-level crime rates.

Source: https://crime-data-explorer.fr.cloud.gov/
Agency-level offense counts aggregated to county level.
County rate = sum(agency offenses) / county population * 100,000.

API key required: env FBI_CDE_API_KEY (free at https://www.api.data.gov/signup/)

NOTE: This data is APPROXIMATE (UCR participation gaps). The loader writes
agencies_reporting so the page can suppress low-coverage counties (< 2 agencies).

Usage:
  FBI_CDE_API_KEY=... DATABASE_URL=... python load_fbi_crime.py [--year 2022]
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

import requests

FBI_BASE = "https://api.usa.gov/crime/fbi/sapi"
FBI_KEY_PARAM = "API_KEY"
TIMEOUT = 15
DELAY = 0.5  # seconds between requests — be polite
CENSUS_HEADERS = {"User-Agent": "Mozilla/5.0 (OnePercentRealEstate)"}  # Census API requires UA

# fallback top-15 states by listing count
FALLBACK_STATES = [
    "CA", "TX", "FL", "NY", "IL", "PA", "OH", "GA", "NC",
    "MI", "NJ", "VA", "WA", "AZ", "MA",
]

# State abbreviation → 2-digit FIPS
STATE_FIPS_MAP = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06",
    "CO": "08", "CT": "09", "DE": "10", "FL": "12", "GA": "13",
    "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19",
    "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24",
    "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29",
    "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34",
    "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45",
    "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50",
    "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56",
    "DC": "11",
}


def get_top_states(n: int = 15) -> list[str]:
    """Query DB for top-N states by listing count, fallback to hardcoded list."""
    try:
        import psycopg2
        conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT state, COUNT(*) AS cnt
                    FROM listings
                    WHERE state IS NOT NULL AND length(state) = 2
                    GROUP BY state
                    ORDER BY cnt DESC
                    LIMIT %s
                """, (n,))
                rows = cur.fetchall()
                if rows:
                    return [r[0] for r in rows]
        finally:
            conn.close()
    except Exception as exc:
        print(f"  DB query failed ({exc}), using fallback states", file=sys.stderr)
    return FALLBACK_STATES[:n]


def fetch_agencies(state_abbr: str, api_key: str) -> list[dict[str, Any]]:
    """Fetch agencies for a state. Returns list of {ori, county_name, latitude, longitude}."""
    url = f"{FBI_BASE}/agency/byStateAbbr/{state_abbr}"
    params = {FBI_KEY_PARAM: api_key}
    try:
        resp = requests.get(url, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        # FBI API returns a dict keyed by county name → flatten to list
        if isinstance(data, dict) and not any(k in data for k in ("results", "data")):
            agencies = []
            for county_key, agency_list in data.items():
                if isinstance(agency_list, list):
                    for a in agency_list:
                        a["county_name"] = county_key
                    agencies.extend(agency_list)
        elif isinstance(data, list):
            agencies = data
        else:
            agencies = data.get("results", data.get("data", []))
        result = []
        for a in agencies:
            county = (a.get("county_name") or a.get("counties") or a.get("agency_county_name") or "").strip()
            if not county:
                continue
            result.append({
                "ori": a.get("ori", ""),
                "county_name": county,
                "state_abbr": state_abbr,
            })
        return result
    except Exception as exc:
        print(f"  agencies {state_abbr}: {exc}", file=sys.stderr)
        return []


def fetch_crime_summary(ori: str, crime_type: str, year: int, api_key: str) -> int:
    """Fetch total offense count for an agency and crime type in a given year."""
    url = f"{FBI_BASE}/summarized/agency/{ori}/{crime_type}"
    params = {
        "from": f"{year}-01-01",
        "to": f"{year}-12-31",
        FBI_KEY_PARAM: api_key,
    }
    try:
        resp = requests.get(url, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        # response may be a list of yearly summaries or nested
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("results", data.get("data", [data]))
        else:
            return 0
        total = 0
        for item in items:
            # look for total offense count in various field names
            for key in ("total_offenses", "offenses", "count", "actual", "actual_count"):
                val = item.get(key)
                if val is not None:
                    try:
                        total += int(val)
                    except (TypeError, ValueError):
                        pass
        return total
    except Exception as exc:
        print(f"  crime {ori}/{crime_type}: {exc}", file=sys.stderr)
        return 0


def build_county_fips_lookup(_state_fips_codes: list[str], _api_key: str) -> dict[tuple[str, str], str]:
    """Build county_name (upper) → 5-digit FIPS lookup from static Census reference.

    Downloads the official national county FIPS file (no API key required).
    Returns dict: {(state_abbr_upper, county_name_upper): fips_5}
    """
    lookup: dict[tuple[str, str], str] = {}
    url = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt"
    try:
        resp = requests.get(url, headers=CENSUS_HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        # Format: " State FIPS | State Abbrev | County FIPS | County Name | Functional Status"
        for line in resp.text.strip().split("\n"):
            line = line.strip()
            if not line or line.startswith("State"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 4:
                continue
            state_fips_code = parts[0].strip()
            state_abbr = parts[1].strip().upper()
            county_fips = parts[2].strip()
            county_name = parts[3].strip().upper()
            # Remove standard suffixes for matching
            for suffix in [" COUNTY", " PARISH", " CITY AND BOROUGH",
                           " MUNICIPALITY", " BOROUGH", " CITY"]:
                if county_name.endswith(suffix):
                    county_name = county_name[:-len(suffix)].strip()
                    break
            fips_5 = state_fips_code + county_fips
            lookup[(state_abbr, county_name)] = fips_5
    except Exception as exc:
        print(f"  census county FIPS download failed: {exc}", file=sys.stderr)
    return lookup


def get_county_populations() -> dict[str, float]:
    """Roll up population from tract_demographics to county level.

    Returns dict: {5_digit_fips: total_population}
    """
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT left(geoid, 5) AS county_fips, SUM(population) AS total_pop
                FROM tract_demographics
                WHERE geoid IS NOT NULL AND length(geoid) = 11
                GROUP BY county_fips
                HAVING SUM(population) > 0
            """)
            return {row[0]: float(row[1]) for row in cur.fetchall()}
    finally:
        conn.close()


def normalize_county_name(name: str) -> str:
    """Normalize county name for matching."""
    name = name.strip().upper()
    # remove common suffixes
    for suffix in [" COUNTY", " PARISH", " CITY AND BOROUGH",
                   " MUNICIPALITY", " BOROUGH"]:
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
            break
    return name


def upsert(rows: list[tuple[str, int, float, float, int]]) -> int:
    """Upsert (fips, year, violent_per_100k, property_per_100k, agencies_reporting)."""
    import psycopg2
    from psycopg2.extras import execute_values

    if not rows:
        return 0

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO crime_county (fips, year, violent_per_100k, property_per_100k, agencies_reporting)
                   VALUES %s
                   ON CONFLICT (fips, year)
                   DO UPDATE SET
                       violent_per_100k    = EXCLUDED.violent_per_100k,
                       property_per_100k   = EXCLUDED.property_per_100k,
                       agencies_reporting  = EXCLUDED.agencies_reporting""",
                rows,
                page_size=5000,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def main() -> None:
    api_key = os.environ.get("FBI_CDE_API_KEY", "")
    if not api_key:
        print("ERROR: FBI_CDE_API_KEY env var required", file=sys.stderr)
        sys.exit(1)

    import argparse
    parser = argparse.ArgumentParser(description="Load FBI CDE crime data")
    parser.add_argument("--year", type=int, default=2022, help="Crime data year (default: 2022)")
    args = parser.parse_args()
    year = args.year

    # Step 1: Get top states
    states = get_top_states()
    print(f"Top states: {', '.join(states)}", file=sys.stderr)

    # Step 2: Build county FIPS lookup from Census
    state_fips_codes = [STATE_FIPS_MAP[s] for s in states if s in STATE_FIPS_MAP]
    print("Building county FIPS lookup from Census...", file=sys.stderr)
    county_lookup = build_county_fips_lookup(state_fips_codes, api_key)
    print(f"  {len(county_lookup)} county mappings", file=sys.stderr)

    # Step 3: Get county populations from DB
    print("Loading county populations...", file=sys.stderr)
    county_pops = get_county_populations()
    print(f"  {len(county_pops)} counties with population data", file=sys.stderr)

    # Step 4: Fetch agencies and crime data per state
    # county_key -> {violent: int, property: int, agencies: int}
    county_data: dict[str, dict[str, Any]] = {}

    for state in states:
        print(f"Processing {state}...", file=sys.stderr)
        agencies = fetch_agencies(state, api_key)
        print(f"  {len(agencies)} agencies in {state}", file=sys.stderr)

        for agency in agencies:
            ori = agency["ori"]
            county_name = normalize_county_name(agency["county_name"])

            fips = county_lookup.get((state, county_name))
            if not fips:
                # try fuzzy: sometimes FBI uses slightly different names
                # just skip if we can't match
                print(f"  SKIP: no FIPS for {state}/{agency['county_name']}", file=sys.stderr)
                continue

            if fips not in county_data:
                county_data[fips] = {"violent": 0, "property": 0, "agencies": set()}

            # fetch violent crime
            violent = fetch_crime_summary(ori, "violent-crime", year, api_key)
            county_data[fips]["violent"] += violent
            county_data[fips]["agencies"].add(ori)

            time.sleep(DELAY)

            # fetch property crime
            property_crime = fetch_crime_summary(ori, "property-crime", year, api_key)
            county_data[fips]["property"] += property_crime

            time.sleep(DELAY)

    # Step 5: Compute rates and build rows
    rows: list[tuple[str, int, float, float, int]] = []
    skipped_low = 0
    skipped_nopop = 0

    for fips, data in county_data.items():
        agencies_reporting = len(data["agencies"])
        if agencies_reporting < 1:
            skipped_low += 1
            continue

        pop = county_pops.get(fips)
        if not pop or pop <= 0:
            skipped_nopop += 1
            continue

        violent_rate = (data["violent"] / pop) * 100_000
        property_rate = (data["property"] / pop) * 100_000

        rows.append((fips, year, round(violent_rate, 2), round(property_rate, 2), agencies_reporting))

    # Step 6: Upsert
    n = upsert(rows)
    print(json.dumps({
        "done": True,
        "rows": n,
        "year": year,
        "skipped_low_coverage": skipped_low,
        "skipped_no_population": skipped_nopop,
    }))


if __name__ == "__main__":
    main()
