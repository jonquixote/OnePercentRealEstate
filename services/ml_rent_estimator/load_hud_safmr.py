"""Load HUD Small Area FMRs (ZIP x bedrooms) into the hud_safmr table.

Source: https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html
File format (FY2026 verified): sheet1 with header
  ZIP Code | HUD Area Code | Area Name | SAFMR 0BR | 0BR-90% | 0BR-110% | SAFMR 1BR | ... | SAFMR 4BR | ...
We take the base SAFMR per bedroom count (columns 3, 6, 9, 12, 15).

Two modes:
  --tsv       parse the xlsx and write "zip\tbedrooms\tsafmr\tfy" rows to stdout
              (pipe into:  psql -c "\\copy hud_safmr_stage FROM STDIN")
  (default)   parse and upsert directly via DATABASE_URL

Usage:
  python load_hud_safmr.py fy2026_safmrs.xlsx 2026 --tsv > safmr.tsv
  DATABASE_URL=... python load_hud_safmr.py fy2026_safmrs.xlsx 2026
"""
from __future__ import annotations

import sys

BR_COLS = {0: 3, 1: 6, 2: 9, 3: 12, 4: 15}


def parse(xlsx_path: str, fy: int):
    import openpyxl  # local dep only; not needed by the runtime image

    wb = openpyxl.load_workbook(xlsx_path, read_only=True)
    ws = wb.active
    assert ws is not None, "workbook has no active sheet"
    rows = ws.iter_rows(min_row=2, values_only=True)
    # A ZIP can span multiple HUD metro areas and appear several times in the
    # file. Dedupe on (zip, beds), keeping the MAX safmr — deterministic, and
    # a conservative-high anchor beats an arbitrary first-row pick.
    best: dict[tuple[str, int], float] = {}
    for r in rows:
        zip_code = str(r[0]).strip() if r[0] is not None else ""
        if not zip_code or not zip_code[:5].isdigit():
            continue
        zip_code = zip_code[:5].zfill(5)
        for beds, col in BR_COLS.items():
            v = r[col]
            if v is None:
                continue
            try:
                safmr = float(str(v))
            except (TypeError, ValueError):
                continue
            if safmr <= 0:
                continue
            key = (zip_code, beds)
            if safmr > best.get(key, 0.0):
                best[key] = safmr
    return [(z, b, s, fy) for (z, b), s in sorted(best.items())]


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    xlsx_path, fy = sys.argv[1], int(sys.argv[2])
    rows = parse(xlsx_path, fy)
    if "--tsv" in sys.argv:
        w = sys.stdout
        for z, b, s, y in rows:
            w.write(f"{z}\t{b}\t{s}\t{y}\n")
        print(f"emitted {len(rows)} rows", file=sys.stderr)
        return

    import os

    import psycopg2
    from psycopg2.extras import execute_values

    dsn = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(dsn)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """INSERT INTO hud_safmr (zip_code, bedrooms, safmr, fy) VALUES %s
                   ON CONFLICT (zip_code, bedrooms, fy) DO UPDATE SET safmr = EXCLUDED.safmr""",
                rows,
                page_size=5000,
            )
        conn.commit()
        print(f"upserted {len(rows)} rows")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
