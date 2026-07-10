"""Load FEMA National Risk Index (NRI) census-tract scores into census_tracts.

Source zip (verify URL at execution; it moves between NRI releases):
  https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_CensusTracts.zip

Columns used from the CSV (v1.20):
  TRACTFIPS          GEOID (11-digit census tract code)
  IFLD_RISKS         Inland flood risk score (replaces RFLD_RISKS in v1.20)
  CFLD_RISKS         Coastal flood risk score (0-100)
  RISK_SCORE         Overall NRI risk score (0-100)
  RISK_RATNG         Overall NRI risk rating (Very Low / Relatively Low / Relatively High / Very High)

Usage:
  python load_nri.py NRI_Table_CensusTracts.csv
  DATABASE_URL=... python load_nri.py NRI_Table_CensusTracts.csv
"""
from __future__ import annotations

import csv
import os
import sys


def parse(path: str) -> list[dict]:
    """Parse the NRI census-tract CSV. Returns list of {geoid, riverine, coastal, overall, rating}."""
    rows: list[dict] = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        expected = {"TRACTFIPS", "IFLD_RISKS", "CFLD_RISKS", "RISK_SCORE", "RISK_RATNG"}
        if not expected.issubset(reader.fieldnames or []):
            print(f"ERROR: CSV columns missing; got {reader.fieldnames}", file=sys.stderr)
            sys.exit(1)
        for r in reader:
            geoid = (r.get("TRACTFIPS") or "").strip()
            if not geoid:
                continue
            row = {
                "geoid": geoid,
                "riverine": _null_blank(r.get("IFLD_RISKS")),
                "coastal": _null_blank(r.get("CFLD_RISKS")),
                "overall_score": _null_blank(r.get("RISK_SCORE")),
                "overall_rating": (r.get("RISK_RATNG") or "").strip() or None,
            }
            rows.append(row)
    print(f"parsed {len(rows)} NRI tract rows", file=sys.stderr)
    return rows


def _null_blank(v: str | None) -> float | None:
    if v is None:
        return None
    s = v.strip()
    if not s or s == "N/A":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    rows = parse(path)

    import psycopg2

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(dsn)
    try:
        from psycopg2.extras import execute_values

        CHUNK = 5000
        updated = 0
        for i in range(0, len(rows), CHUNK):
            chunk = rows[i : i + CHUNK]
            with conn.cursor() as cur:
                execute_values(
                    cur,
                    """UPDATE census_tracts
                          SET nri_flood_riverine_score = data.riverine,
                              nri_flood_coastal_score  = data.coastal,
                              nri_overall_score        = data.overall_score,
                              nri_overall_rating       = data.overall_rating
                         FROM (VALUES %s) AS data(geoid, riverine, coastal, overall_score, overall_rating)
                        WHERE census_tracts.geoid = data.geoid""",
                    [(r["geoid"], r["riverine"], r["coastal"], r["overall_score"], r["overall_rating"]) for r in chunk],
                )
                updated += cur.rowcount
            conn.commit()
            print(f"  updated {updated} rows...", file=sys.stderr)
        print(f"NRI update complete: {updated} census_tracts updated", file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
