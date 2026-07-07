"""Load FEMA National Risk Index (NRI) census-tract scores into census_tracts.

Source zip (verify URL at execution; it moves between NRI releases):
  https://hazards.fema.gov/nri/Content/StaticDocuments/DataDownload/NRI_Table_CensusTracts/NRI_Table_CensusTracts.zip

Columns used from the CSV:
  TRACTFIPS          GEOID (11-digit census tract code)
  RFLD_RISKS         Riverine flood risk score (0-100)
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
        expected = {"TRACTFIPS", "RFLD_RISKS", "CFLD_RISKS", "RISK_SCORE", "RISK_RATNG"}
        if not expected.issubset(reader.fieldnames or []):
            print(f"ERROR: CSV columns missing; got {reader.fieldnames}", file=sys.stderr)
            sys.exit(1)
        for r in reader:
            geoid = (r.get("TRACTFIPS") or "").strip()
            if not geoid:
                continue
            row = {
                "geoid": geoid,
                "riverine": _null_blank(r.get("RFLD_RISKS")),
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
        with conn.cursor() as cur:
            updated = 0
            for r in rows:
                cur.execute(
                    """UPDATE census_tracts
                          SET nri_flood_riverine_score = %s,
                              nri_flood_coastal_score  = %s,
                              nri_overall_score        = %s,
                              nri_overall_rating       = %s
                        WHERE geoid = %s""",
                    (r["riverine"], r["coastal"], r["overall_score"], r["overall_rating"], r["geoid"]),
                )
                updated += cur.rowcount
                if updated % 10000 == 0:
                    conn.commit()
                    print(f"  updated {updated} rows...", file=sys.stderr)
            conn.commit()
        print(f"NRI update complete: {updated} census_tracts updated", file=sys.stderr)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
