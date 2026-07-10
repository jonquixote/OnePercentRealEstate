"""Load NCES EDGE public school locations into the schools table.

Source (2024-25):
  https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2425.zip
  Contains EDGE_GEOCODE_PUBLICSCH_YY.TXT (pipe-delimited, no header).

Columns (0-indexed):
  0  NCESSCH   school ID
  1  LEAID     district ID
  2  NAME      school name
  12 LAT       latitude
  13 LON       longitude

LEVEL is derived from the school name (Elementary / Middle / High / Other).

Usage:
  DATABASE_URL=... python load_nces_schools.py
  DATABASE_URL=... python load_nces_schools.py --csv /path/to/schools.csv
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import urllib.request

URLS = [
    "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2425.zip",
    "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2324.zip",
]

LEVEL_KEYWORDS = [
    ("elementary", "Elementary"),
    ("middle", "Middle"),
    ("intermediate", "Middle"),
    ("high", "High"),
    ("academy", "High"),
    ("prek", "Other"),
    ("pre-k", "Other"),
    ("kindergarten", "Other"),
]


def derive_level(name: str) -> str:
    lower = name.lower()
    for kw, level in LEVEL_KEYWORDS:
        if kw in lower:
            return level
    return "Other"


def parse_txt(path: str) -> list[tuple[str, str, str, float, float]]:
    rows: list[tuple[str, str, str, float, float]] = []
    with open(path, newline="") as f:
        for line in f:
            parts = line.rstrip("\n").split("|")
            if len(parts) < 14:
                continue
            ncessch = parts[0].strip()
            name = parts[2].strip()
            try:
                lat = float(parts[12])
                lon = float(parts[13])
            except (ValueError, IndexError):
                continue
            if not ncessch or lat == 0.0 and lon == 0.0:
                continue
            level = derive_level(name)
            rows.append((ncessch, name, level, lat, lon))
    return rows


def parse_csv(path: str) -> list[tuple[str, str, str, float, float]]:
    rows: list[tuple[str, str, str, float, float]] = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            return rows
        cols = {c.strip().upper(): c for c in reader.fieldnames}
        ncessch_key = cols.get("NCESSCH")
        name_key = cols.get("NAME")
        lat_key = cols.get("LAT")
        lon_key = cols.get("LON")
        if not all([ncessch_key, name_key, lat_key, lon_key]):
            raise SystemExit(f"ERROR: missing required columns, have {list(reader.fieldnames)}")
        for row in reader:
            ncessch = row[ncessch_key].strip()
            name = row[name_key].strip()
            try:
                lat = float(row[lat_key])
                lon = float(row[lon_key])
            except (ValueError, KeyError):
                continue
            if not ncessch or (lat == 0.0 and lon == 0.0):
                continue
            level = derive_level(name)
            rows.append((ncessch, name, level, lat, lon))
    return rows


def _download() -> str:
    import tempfile
    import zipfile

    for url in URLS:
        try:
            print(f"Downloading {url}", file=sys.stderr)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
            if len(data) < 1000:
                continue
            tmp_dir = tempfile.mkdtemp()
            zip_path = os.path.join(tmp_dir, "schools.zip")
            with open(zip_path, "wb") as f:
                f.write(data)
            with zipfile.ZipFile(zip_path) as zf:
                txt_names = [n for n in zf.namelist() if n.upper().endswith(".TXT")]
                if not txt_names:
                    print(f"  no .TXT in zip: {zf.namelist()}", file=sys.stderr)
                    continue
                zf.extract(txt_names[0], tmp_dir)
                return os.path.join(tmp_dir, txt_names[0])
        except Exception as exc:
            print(f"  failed: {exc}", file=sys.stderr)
    raise SystemExit("ERROR: could not download NCES school locations from any URL")


def upsert(rows: list[tuple], conn) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO schools (ncessch, name, level, geom)
               VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
               ON CONFLICT (ncessch) DO UPDATE SET
                   name  = EXCLUDED.name,
                   level = EXCLUDED.level,
                   geom  = EXCLUDED.geom""",
            [(r[0], r[1], r[2], r[4], r[3]) for r in rows],
        )
    conn.commit()


def main() -> None:
    csv_path = None
    if "--csv" in sys.argv:
        i = sys.argv.index("--csv")
        csv_path = sys.argv[i + 1] if i + 1 < len(sys.argv) else None
        if csv_path is None:
            raise SystemExit("ERROR: --csv requires a file path")

    if csv_path:
        rows = parse_csv(csv_path)
    else:
        txt_path = _download()
        rows = parse_txt(txt_path)

    if not rows:
        raise SystemExit("ERROR: no rows parsed")

    import psycopg2

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        upsert(rows, conn)
    finally:
        conn.close()

    print(json.dumps({"done": True, "rows": len(rows)}))


if __name__ == "__main__":
    main()
