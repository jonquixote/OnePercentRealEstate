"""Load OpenFEMA disaster declarations into the fema_disasters table.

Source: https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
No API key required.

Aggregates per (fips, fy, incident_type). Skips county code 000 (statewide).

Usage:
  DATABASE_URL=... python load_fema_disasters.py
"""
from __future__ import annotations

import json
import os
import sys

import requests

BASE_URL = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries"
PAGE_SIZE = 10000
FILTER = "declarationDate ge '2015-01-01'"
SELECT = "fipsStateCode,fipsCountyCode,incidentType,declarationDate,fyDeclared"
TIMEOUT = 15


def fetch_all() -> list[tuple[str, int, str]]:
    """Fetch all disaster declarations since 2015, returning (fips, fy, incident_type)."""
    counts: dict[tuple[str, int, str], int] = {}
    skip = 0
    while True:
        params = {
            "$filter": FILTER,
            "$select": SELECT,
            "$top": str(PAGE_SIZE),
            "$skip": str(skip),
        }
        print(f"  fetching skip={skip}", file=sys.stderr)
        resp = requests.get(BASE_URL, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        records = resp.json().get("DisasterDeclarationsSummaries", [])
        if not records:
            break
        for r in records:
            state = str(r.get("fipsStateCode", "")).strip()
            county = str(r.get("fipsCountyCode", "")).strip()
            if county == "000":
                continue
            fips = (state + county).zfill(5)
            fy = r.get("fyDeclared")
            if fy is None:
                continue
            fy = int(fy)
            incident = str(r.get("incidentType", "")).strip()
            key = (fips, fy, incident)
            counts[key] = counts.get(key, 0) + 1
        skip += PAGE_SIZE
    return [(fips, fy, inc, n) for (fips, fy, inc), n in counts.items()]


def upsert(rows: list[tuple[str, int, str, int]]) -> int:
    import psycopg2
    from psycopg2.extras import execute_values

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO fema_disasters (fips, fy, incident_type, declarations)
                   VALUES %s
                   ON CONFLICT (fips, fy, incident_type)
                   DO UPDATE SET declarations = EXCLUDED.declarations""",
                rows,
                page_size=5000,
            )
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def main() -> None:
    rows = fetch_all()
    n = upsert(rows)
    print(json.dumps({"done": True, "rows": n}))


if __name__ == "__main__":
    main()
