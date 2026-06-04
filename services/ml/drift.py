"""Rent estimator drift monitor.

Run as: `python -m services.ml.drift`

Computes Population Stability Index (PSI) per feature over the last 7
days of `listings` vs the training-distribution snapshot stored on the
active row in `rent_models.metrics`. Exits 0 if all PSI < 0.2, 1
otherwise — so a cron job + alertmanager can fire on non-zero exit.

PSI bucketing convention (matches the standard credit-modeling cut):
- < 0.1  : no significant shift
- 0.1–0.2: minor shift, monitor
- > 0.2  : material shift, retrain or investigate
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor


# Features we track + bin definitions. We use fixed bins per feature so
# the comparison is stable across runs — adaptive binning would let a
# distribution shift hide inside the bin recomputation.
NUMERIC_FEATURES: Dict[str, List[float]] = {
    # Bin edges chosen to match how the consumer UI buckets these:
    "price": [0, 200_000, 400_000, 600_000, 800_000, 1_200_000, math.inf],
    "sqft": [0, 1000, 1500, 2000, 2500, 3500, math.inf],
    "beds": [0, 1, 2, 3, 4, 5, math.inf],
    "dom": [0, 7, 30, 60, 90, 180, math.inf],
}
CATEGORICAL_FEATURES = ["region"]  # state code is the cheapest "region" proxy


@dataclass
class FeatureResult:
    name: str
    psi: float
    decision: str  # 'ok' | 'monitor' | 'alert'


def bucket_numeric(values: List[float], edges: List[float]) -> List[int]:
    """Return histogram counts for given bin edges (left-inclusive)."""
    counts = [0] * (len(edges) - 1)
    for v in values:
        if v is None:
            continue
        for i in range(len(edges) - 1):
            if edges[i] <= v < edges[i + 1]:
                counts[i] += 1
                break
    return counts


def bucket_categorical(values: List[str], categories: List[str]) -> List[int]:
    counts = Counter(values)
    return [counts.get(c, 0) for c in categories]


def psi(observed: List[int], expected: List[int]) -> float:
    """Standard PSI = sum((o% - e%) * ln(o% / e%)).

    Guards against zero bins by replacing them with a tiny epsilon —
    standard practice; otherwise PSI explodes whenever a bin is empty.
    """
    total_o = sum(observed) or 1
    total_e = sum(expected) or 1
    eps = 1e-4
    s = 0.0
    for o, e in zip(observed, expected):
        p_o = max(o / total_o, eps)
        p_e = max(e / total_e, eps)
        s += (p_o - p_e) * math.log(p_o / p_e)
    return round(s, 4)


def decision_for(score: float) -> str:
    if score >= 0.2:
        return "alert"
    if score >= 0.1:
        return "monitor"
    return "ok"


def load_active_distribution(conn) -> Optional[Dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            "SELECT metrics FROM rent_models WHERE active = true LIMIT 1"
        )
        row = cur.fetchone()
        if not row or not row.get("metrics"):
            return None
        metrics = row["metrics"]
        # metrics may carry a 'training_distribution' key. If it doesn't
        # exist, we can't compute drift (v0 baseline never trained).
        return metrics.get("training_distribution") if isinstance(metrics, dict) else None


def load_recent_distribution(conn, days: int) -> Dict[str, List]:
    """Pull the last `days` of listings and return per-feature value lists."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            f"""
            SELECT
                price,
                sqft,
                bedrooms AS beds,
                days_on_market AS dom,
                COALESCE(state, 'unknown') AS region
              FROM listings
             WHERE created_at > NOW() - INTERVAL '{int(days)} days'
            """
        )
        rows = cur.fetchall()
    return {
        "price": [float(r["price"]) for r in rows if r["price"] is not None],
        "sqft": [float(r["sqft"]) for r in rows if r["sqft"] is not None],
        "beds": [float(r["beds"]) for r in rows if r["beds"] is not None],
        "dom": [float(r["dom"]) for r in rows if r["dom"] is not None],
        "region": [str(r["region"]) for r in rows],
    }


def synth_baseline_from_listings(conn) -> Dict:
    """If the active model has no training_distribution metadata, build a
    naive baseline from the full listings table. This makes the drift CLI
    useful immediately against the seeded v0 row — anything that drifts
    against the historical mean is at least surfaced for inspection.
    """
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                price,
                sqft,
                bedrooms AS beds,
                days_on_market AS dom,
                COALESCE(state, 'unknown') AS region
              FROM listings
             WHERE created_at < NOW() - INTERVAL '7 days'
            """
        )
        rows = cur.fetchall()
    if not rows:
        return {}

    regions = sorted({str(r["region"]) for r in rows})
    return {
        "numeric": {
            name: bucket_numeric(
                [float(r[name]) for r in rows if r[name] is not None],
                edges,
            )
            for name, edges in NUMERIC_FEATURES.items()
        },
        "categorical": {
            "region": {
                "categories": regions,
                "counts": bucket_categorical([str(r["region"]) for r in rows], regions),
            },
        },
    }


def compute(conn, days: int) -> Tuple[List[FeatureResult], Dict]:
    baseline = load_active_distribution(conn)
    if not baseline:
        baseline = synth_baseline_from_listings(conn)

    recent = load_recent_distribution(conn, days)
    results: List[FeatureResult] = []

    numeric_baseline = (baseline or {}).get("numeric", {})
    for name, edges in NUMERIC_FEATURES.items():
        obs = bucket_numeric(recent.get(name, []), edges)
        exp = numeric_baseline.get(name, [0] * (len(edges) - 1))
        s = psi(obs, exp)
        results.append(FeatureResult(name=name, psi=s, decision=decision_for(s)))

    cat_baseline = (baseline or {}).get("categorical", {})
    region_meta = cat_baseline.get("region", {})
    categories = region_meta.get("categories") or sorted(set(recent.get("region", [])))
    expected_counts = region_meta.get("counts") or [0] * len(categories)
    observed_counts = bucket_categorical(recent.get("region", []), categories)
    region_psi = psi(observed_counts, expected_counts)
    results.append(
        FeatureResult(name="region", psi=region_psi, decision=decision_for(region_psi))
    )

    return results, baseline or {}


def render(results: List[FeatureResult], days: int) -> str:
    lines = [
        f"# Rent Estimator Drift — {datetime.now(timezone.utc).isoformat()}",
        "",
        f"Window: last {days} days of `listings` vs baseline distribution",
        "",
        "| feature | PSI | decision |",
        "|---|---|---|",
    ]
    for r in results:
        lines.append(f"| {r.name} | {r.psi} | {r.decision} |")
    lines.append("")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute PSI drift for the rent estimator.")
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--out", type=str, default=None)
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set", file=sys.stderr)
        return 2

    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")
    os.makedirs(out_dir, exist_ok=True)
    out_path: Optional[str] = args.out or os.path.join(
        out_dir, f"drift-{int(time.time())}.md"
    )

    with psycopg2.connect(db_url) as conn:
        results, _ = compute(conn, args.days)

    report = render(results, args.days)
    if out_path:
        with open(out_path, "w") as f:
            f.write(report)
        print(f"Wrote {out_path}", file=sys.stderr)
    print(report)

    # Exit 1 if anything is in alert territory so cron + alertmanager
    # treats the run as a failure.
    return 1 if any(r.decision == "alert" for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
