"""Load EPA Smart Location Database v3 — National Walkability Index.

Source (~220 MB CSV):
  https://edap-ecf.s3.us-west-2.amazonaws.com/docsets/smartlocation/SmartLocationDBv3.csv

Columns used: GEOID10 (12-digit block group FIPS), NatWalkInd, D2A_EPHHM, D3B, D4A

Usage:
  DATABASE_URL=... python load_epa_walkability.py
  DATABASE_URL=... python load_epa_walkability.py --csv /path/to/SmartLocationDBv3.csv
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

import pandas as pd

URLS = [
    "https://edg.epa.gov/data/public/OA/EPA_SmartLocationDatabase_V3_Jan_2021_Final.csv",
    "https://edap-ecf.s3.us-west-2.amazonaws.com/docsets/smartlocation/SmartLocationDBv3.csv",
    "https://www.epa.gov/system/files/documents/smartlocationdbv3.csv",
]

USE_COLS = ["GEOID10", "NatWalkInd", "D2A_EPHHM", "D3B", "D4A"]
RENAME = {
    "GEOID10": "geoid_bg",
    "NatWalkInd": "natwalkind",
    "D2A_EPHHM": "d2a_ephhm",
    "D3B": "d3b",
    "D4A": "d4a",
}


def _to_float(v):
    if pd.isna(v):
        return None
    s = str(v).strip()
    if s in ("", ".", "NA", "N/A"):
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def parse_rows(df: pd.DataFrame) -> list[tuple[str, float | None, float | None, float | None, float | None]]:
    rows: list[tuple[str, float | None, float | None, float | None, float | None]] = []
    for _, r in df.iterrows():
        raw = r["geoid_bg"]
        if pd.isna(raw) or str(raw).strip() == "":
            continue
        # EPA SLD v3 stores GEOID10 as scientific notation (e.g. "4.8113E+11");
        # coerce via float so it round-trips to a 12-digit block-group FIPS.
        try:
            geoid = f"{int(float(raw)):012d}"
        except (TypeError, ValueError):
            continue
        if geoid == "000000000000":
            continue
        rows.append((
            geoid,
            _to_float(r["natwalkind"]),
            _to_float(r["d2a_ephhm"]),
            _to_float(r["d3b"]),
            _to_float(r["d4a"]),
        ))
    return rows


def _download() -> str:
    for url in URLS:
        try:
            print(f"Downloading {url}", file=sys.stderr)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
            if len(data) > 1000:
                tmp = "/tmp/epa_sld_v3.csv"
                with open(tmp, "wb") as f:
                    f.write(data)
                return tmp
        except Exception as exc:
            print(f"  failed: {exc}", file=sys.stderr)
    raise SystemExit("ERROR: could not download EPA SLD CSV from any URL")


def upsert(rows: list[tuple], conn) -> None:
    import psycopg2.extras as extras

    with conn.cursor() as cur:
        extras.execute_values(
            cur,
            """INSERT INTO epa_walkability (geoid_bg, natwalkind, d2a_ephhm, d3b, d4a)
               VALUES %s
               ON CONFLICT (geoid_bg) DO UPDATE SET
                   natwalkind = COALESCE(EXCLUDED.natwalkind, epa_walkability.natwalkind),
                   d2a_ephhm  = COALESCE(EXCLUDED.d2a_ephhm, epa_walkability.d2a_ephhm),
                   d3b        = COALESCE(EXCLUDED.d3b, epa_walkability.d3b),
                   d4a        = COALESCE(EXCLUDED.d4a, epa_walkability.d4a)""",
            rows,
            page_size=5000,
        )
    conn.commit()


def main() -> None:
    csv_path = None
    if "--csv" in sys.argv:
        i = sys.argv.index("--csv")
        csv_path = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
        if csv_path is None:
            raise SystemExit("ERROR: --csv requires a file path")

    if csv_path is None:
        csv_path = _download()

    import psycopg2

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    total = 0
    try:
        for chunk in pd.read_csv(csv_path, usecols=USE_COLS, dtype=str, chunksize=100_000):
            chunk.rename(columns=RENAME, inplace=True)
            chunk.drop_duplicates(subset=["geoid_bg"], keep="first", inplace=True)
            rows = parse_rows(chunk)
            if rows:
                upsert(rows, conn)
                total += len(rows)
                print(f"  upserted chunk: {len(rows)} rows (total {total})", file=sys.stderr)
    finally:
        conn.close()

    print(json.dumps({"done": True, "rows": total}))


if __name__ == "__main__":
    main()
