"""Load FHFA annual ZIP5 House Price Index into fhfa_zip_hpi.

Source (2026-07 verified):
  xlsx: https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx
  (no CSV published by FHFA for ZIP5; xlsx is the canonical format)

Columns (header row 1): Five-Digit ZIP Code, Year, Annual Change (%), HPI
Some cells use "." for missing — mapped to None.

Usage:
  DATABASE_URL=... python load_fhfa_hpi.py
  DATABASE_URL=... python load_fhfa_hpi.py --csv local_file.csv
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request

URLS = [
    "https://www.fhfa.gov/hpi/download/annual/hpi_at_zip5.xlsx",
    "https://www.fhfa.gov/DataTools/Downloads/Documents/hpi_at_bdl_zip5.xlsx",
]


def _to_float(v: str | None) -> float | None:
    if v is None:
        return None
    s = str(v).strip()
    if s in ("", ".", "NA", "N/A"):
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _download() -> bytes:
    for url in URLS:
        try:
            print(f"Downloading {url}", file=sys.stderr)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
            if len(data) > 1000:
                return data
        except Exception as exc:
            print(f"  failed: {exc}", file=sys.stderr)
    raise SystemExit("ERROR: could not download FHFA ZIP5 HPI from any URL")


def parse_xlsx(data: bytes) -> list[tuple[str, int, float | None, float | None]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True)
    ws = wb.active
    assert ws is not None, "workbook has no active sheet"
    rows = ws.iter_rows(values_only=True)
    # Scan for header row — first cell contains 'ZIP Code' and second is 'Year'
    header = None
    for row in rows:
        if row and 'ZIP Code' in str(row[0]) and str(row[1]).strip() == 'Year':
            header = row
            break
    assert header is not None, "could not find header row"

    cols = {str(h).strip(): i for i, h in enumerate(header) if h}
    zip_col = cols.get("Five-Digit ZIP Code") if "Five-Digit ZIP Code" in cols else cols.get("Zip Code")
    yr_col = cols.get("Year")
    chg_col = cols.get("Annual Change (%)") if "Annual Change (%)" in cols else cols.get("annual_change_pct")
    hpi_col = cols.get("HPI")
    if zip_col is None or yr_col is None or hpi_col is None:
        raise SystemExit(f"ERROR: unexpected columns {list(cols.keys())}")

    result: list[tuple[str, int, float | None, float | None]] = []
    for r in rows:
        z = str(r[zip_col]).strip().zfill(5) if r[zip_col] is not None else ""
        if not z or z == "00000":
            continue
        try:
            yr = int(r[yr_col])
        except (TypeError, ValueError):
            continue
        result.append((z, yr, _to_float(r[chg_col]) if chg_col is not None else None, _to_float(r[hpi_col])))
    wb.close()
    return result


def parse_csv(path: str) -> list[tuple[str, int, float | None, float | None]]:
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames is not None
        cols = {c.strip(): c for c in reader.fieldnames}

        zip_key = cols.get("Five-Digit ZIP Code") or cols.get("Zip Code") or cols.get("zip5")
        yr_key = cols.get("Year") or cols.get("year")
        chg_key = cols.get("Annual Change (%)") or cols.get("annual_change_pct")
        hpi_key = cols.get("HPI") or cols.get("hpi")
        if not zip_key or not yr_key or not hpi_key:
            raise SystemExit(f"ERROR: unexpected CSV columns {reader.fieldnames}")

        result: list[tuple[str, int, float | None, float | None]] = []
        for row in reader:
            z = row[zip_key].strip().zfill(5)
            if not z or z == "00000":
                continue
            try:
                yr = int(row[yr_key])
            except (TypeError, ValueError):
                continue
            result.append((z, yr, _to_float(row.get(chg_key)) if chg_key else None, _to_float(row[hpi_key])))
        return result


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
        data = _download()
        rows = parse_xlsx(data)

    if not rows:
        raise SystemExit("ERROR: no rows parsed")

    import psycopg2
    from psycopg2.extras import execute_values

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO fhfa_zip_hpi (zip5, year, hpi, annual_change_pct)
                   VALUES %s
                   ON CONFLICT (zip5, year) DO UPDATE SET
                       hpi = COALESCE(EXCLUDED.hpi, fhfa_zip_hpi.hpi),
                       annual_change_pct = COALESCE(EXCLUDED.annual_change_pct, fhfa_zip_hpi.annual_change_pct)""",
                rows,
                page_size=5000,
            )
        conn.commit()
        print(json.dumps({"done": True, "rows": len(rows)}))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
