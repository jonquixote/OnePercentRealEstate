"""Rent estimator eval harness.

Run as: `python -m services.ml.eval --holdout 0.1`

Pulls a random 10% slice of `rental_listings` (the comp universe — these
are actual listed rents), scores each with the current
`estimate_rent_v2`, and reports MAE / MAPE / RMSE bucketed by metro and
by price band. Writes the report to services/ml/reports/eval-<ts>.md.

This is intentionally simple — it's a metric, not a backtester. The
"model" today is a weighted triangulation of HUD + comps + ML; once a
real trained model lands, this script tells you whether to promote it
by comparing two runs.
"""

from __future__ import annotations

import argparse
import math
import os
import statistics
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Path tweak mirrors main.py so we can import the legacy estimator.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_THIS_DIR)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

import psycopg2  # noqa: E402
from psycopg2.extras import RealDictCursor  # noqa: E402

from rent_estimator_v2 import estimate_rent_v2  # type: ignore  # noqa: E402


PRICE_BANDS = [
    (0, 1000, "<$1k"),
    (1000, 1500, "$1k-$1.5k"),
    (1500, 2000, "$1.5k-$2k"),
    (2000, 3000, "$2k-$3k"),
    (3000, math.inf, ">$3k"),
]


def price_band(rent: float) -> str:
    for lo, hi, label in PRICE_BANDS:
        if lo <= rent < hi:
            return label
    return ">$3k"


@dataclass
class Scored:
    actual: float
    predicted: float
    metro: str
    band: str


def load_holdout(conn, fraction: float, limit: int) -> List[Dict[str, Any]]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                id,
                address,
                latitude,
                longitude,
                bedrooms,
                bathrooms,
                sqft,
                price AS actual_rent,
                COALESCE(city || ', ' || state, 'unknown') AS metro
              FROM rental_listings
             WHERE price > 0
               AND latitude IS NOT NULL
               AND longitude IS NOT NULL
               AND bedrooms IS NOT NULL
               AND random() < %s
             LIMIT %s
            """,
            (fraction, limit),
        )
        return cur.fetchall()


def score(rows: List[Dict[str, Any]]) -> List[Scored]:
    out: List[Scored] = []
    for r in rows:
        try:
            est = estimate_rent_v2(
                lat=float(r["latitude"]),
                lon=float(r["longitude"]),
                bedrooms=int(r["bedrooms"]) if r["bedrooms"] is not None else 0,
                bathrooms=float(r["bathrooms"]) if r["bathrooms"] is not None else None,
                sqft=int(r["sqft"]) if r["sqft"] is not None else None,
            )
        except Exception:
            # Skip rows the estimator can't handle (e.g. HUD lookup fails
            # for missing zip). Don't poison the metrics with synthetic
            # zeros — just drop the row.
            continue
        predicted = float(est.estimated_rent or 0)
        if predicted <= 0:
            continue
        out.append(
            Scored(
                actual=float(r["actual_rent"]),
                predicted=predicted,
                metro=r["metro"],
                band=price_band(float(r["actual_rent"])),
            )
        )
    return out


def metrics(items: List[Scored]) -> Dict[str, float]:
    if not items:
        return {"n": 0, "mae": 0.0, "mape": 0.0, "rmse": 0.0}
    errors = [s.predicted - s.actual for s in items]
    abs_errors = [abs(e) for e in errors]
    pct_errors = [abs(e) / s.actual for e, s in zip(errors, items) if s.actual > 0]
    mae = statistics.fmean(abs_errors)
    mape = statistics.fmean(pct_errors) * 100 if pct_errors else 0.0
    rmse = math.sqrt(statistics.fmean([e * e for e in errors]))
    return {"n": len(items), "mae": round(mae, 2), "mape": round(mape, 2), "rmse": round(rmse, 2)}


def group_by(items: List[Scored], key: str) -> Dict[str, Dict[str, float]]:
    buckets: Dict[str, List[Scored]] = defaultdict(list)
    for s in items:
        buckets[getattr(s, key)].append(s)
    return {k: metrics(v) for k, v in sorted(buckets.items())}


def render(overall: Dict[str, float], by_metro: Dict, by_band: Dict, holdout: float, limit: int) -> str:
    lines = [
        f"# Rent Estimator Eval — {datetime.now(timezone.utc).isoformat()}",
        "",
        f"Holdout fraction: {holdout}, ceiling: {limit}",
        "",
        "## Overall",
        "",
        f"- n: {overall['n']}",
        f"- MAE: ${overall['mae']:.2f}",
        f"- MAPE: {overall['mape']:.2f}%",
        f"- RMSE: ${overall['rmse']:.2f}",
        "",
        "## By metro (top 20 by n)",
        "",
        "| metro | n | MAE | MAPE | RMSE |",
        "|---|---|---|---|---|",
    ]
    top_metros = sorted(by_metro.items(), key=lambda kv: -kv[1]["n"])[:20]
    for m, vals in top_metros:
        lines.append(
            f"| {m} | {vals['n']} | ${vals['mae']:.2f} | {vals['mape']:.2f}% | ${vals['rmse']:.2f} |"
        )
    lines += ["", "## By price band", "", "| band | n | MAE | MAPE | RMSE |", "|---|---|---|---|---|"]
    for band, vals in by_band.items():
        lines.append(
            f"| {band} | {vals['n']} | ${vals['mae']:.2f} | {vals['mape']:.2f}% | ${vals['rmse']:.2f} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Eval the rent estimator against rental_listings.")
    parser.add_argument("--holdout", type=float, default=0.1, help="Sample fraction (0–1).")
    parser.add_argument("--limit", type=int, default=5000, help="Row ceiling.")
    parser.add_argument("--out", type=str, default=None, help="Output markdown path.")
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 2

    out_dir = os.path.join(_THIS_DIR, "reports")
    os.makedirs(out_dir, exist_ok=True)
    out_path: Optional[str] = args.out or os.path.join(
        out_dir, f"eval-{int(time.time())}.md"
    )

    with psycopg2.connect(db_url) as conn:
        rows = load_holdout(conn, args.holdout, args.limit)

    print(f"Loaded {len(rows)} holdout rows. Scoring…", file=sys.stderr)
    scored = score(rows)
    print(f"Scored {len(scored)} rows.", file=sys.stderr)

    overall = metrics(scored)
    by_metro = group_by(scored, "metro")
    by_band = group_by(scored, "band")
    report = render(overall, by_metro, by_band, args.holdout, args.limit)

    if out_path:
        with open(out_path, "w") as f:
            f.write(report)
        print(f"Wrote {out_path}", file=sys.stderr)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
