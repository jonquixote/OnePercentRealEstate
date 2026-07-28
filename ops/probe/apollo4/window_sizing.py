#!/usr/bin/env python3
"""
Apollo IV — how long does a dense ZIP's for_sale pass take, as a function of the
date window?

WHY
---
39 ZIPs consume 19.1% of all crawl runner time and every one of them hits the
240 s SCRAPE_TIMEOUT_MS on its for_sale pass (docs/perf/2026-08-sweep-fairness-audit.md).
Bounding that tail is the largest available lever on the ZIP sweep interval, but
the bound has to reduce work PER REQUEST rather than abandon the request:
aborting the worker's fetch does not stop the scrape, so the worker would start
another job while the scraper is still fetching the abandoned one, putting a
THIRD concurrent request on the source — which is exactly where blocking was
measured.

So the window has to be sized, not guessed. This measures p90 wall time against
past_days on one dense ZIP, and records `count` at each point as well, because
past_days filters by LIST DATE: a narrower window is cheaper AND blinder, and
the tradeoff is only legible with both curves.

SAFETY
------
- Strictly ONE in-flight request. Never concurrent, never retried on timeout.
- The production sweep must be stopped before this runs; the driver script
  enforces it. Two runners plus this probe would be three concurrent requests.
- Ascending ladder, so the cheap points are measured before the expensive ones
  and the run aborts before it reaches a window that cannot complete.
- Aborts on the FIRST structured block signal. Never greps for "403"/"429" in
  free text — ZIP codes contain those digits, which produced a false "725
  blocks" reading on an earlier mission.
- Every attempt is written to JSONL before any analysis, so an abort still
  leaves evidence.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

# The worker's ceiling. The fitted window needs headroom under this, not parity.
SCRAPE_TIMEOUT_MS = 240_000
# Stop laddering once a point's p90 reaches this fraction of the ceiling.
HEADROOM_FRACTION = 0.8
# A single run this much slower than its point's first run reads as throttling.
INFLATION_FACTOR = 2.0
# Politeness gap between requests, matching SCRAPER_MIN_INTERVAL_MS.
GAP_S = 10.0
# Generous per-request ceiling: we must let the scrape COMPLETE rather than
# abandon it, or we leave work running server-side and lose the "1 in flight"
# guarantee. Set well above the worker's own timeout so the true cost is visible.
REQUEST_CEILING_S = 900.0


@dataclass
class Attempt:
    ts: str
    zip_code: str
    past_days: int
    run: int
    warmup: bool
    wall_s: float | None
    http_status: int | None
    bytes_down: int | None
    count: int | None
    inserted: int | None
    updated: int | None
    skipped: int | None
    blocked: bool
    error_kind: str | None
    error_detail: str | None


def classify(status: int | None, body: bytes, err: Exception | None) -> tuple[bool, str | None, str | None]:
    """Return (blocked, error_kind, error_detail) from STRUCTURED signals only."""
    if err is not None:
        if isinstance(err, urllib.error.HTTPError):
            # The scraper's contract: 429 means the source refused us.
            if err.code == 429:
                return True, "blocked_http_429", _detail(body)
            if err.code == 502:
                # Non-block upstream error. Inspect the structured detail for a
                # challenge marker rather than pattern-matching the whole body.
                detail = _detail(body)
                low = (detail or "").lower()
                for marker in ("captcha", "challenge", "forbidden", "unusual traffic"):
                    if marker in low:
                        return True, f"blocked_challenge:{marker}", detail
                return False, "upstream_error_502", detail
            return False, f"http_{err.code}", _detail(body)
        if isinstance(err, TimeoutError):
            return False, "request_ceiling_exceeded", f"> {REQUEST_CEILING_S}s"
        return False, type(err).__name__, str(err)[:300]

    if status is not None and status >= 400:
        return False, f"http_{status}", _detail(body)
    return False, None, None


def _detail(body: bytes) -> str | None:
    if not body:
        return None
    try:
        return json.dumps(json.loads(body.decode("utf-8", "replace")))[:400]
    except Exception:
        return body.decode("utf-8", "replace")[:400]


def one_request(url: str, zip_code: str, past_days: int) -> Attempt:
    payload = json.dumps(
        {"location": zip_code, "listing_type": "for_sale", "past_days": past_days}
    ).encode()
    req = urllib.request.Request(
        url, data=payload, headers={"content-type": "application/json"}, method="POST"
    )
    t0 = time.monotonic()
    status: int | None = None
    body = b""
    err: Exception | None = None
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_CEILING_S) as resp:
            status = resp.status
            body = resp.read()
    except urllib.error.HTTPError as e:  # noqa: PERF203
        err = e
        status = e.code
        body = e.read()
    except Exception as e:
        err = e
    wall = time.monotonic() - t0

    blocked, kind, detail = classify(status, body, err)
    parsed: dict = {}
    if not err and body:
        try:
            parsed = json.loads(body.decode("utf-8", "replace"))
        except Exception:
            parsed = {}
    if parsed.get("blocked") is True:
        blocked = True
        kind = kind or "blocked_flag"

    return Attempt(
        ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        zip_code=zip_code,
        past_days=past_days,
        run=-1,
        warmup=False,
        wall_s=round(wall, 2),
        http_status=status,
        bytes_down=len(body) if body else 0,
        count=parsed.get("count"),
        inserted=parsed.get("inserted"),
        updated=parsed.get("updated"),
        skipped=parsed.get("skipped"),
        blocked=blocked,
        error_kind=kind,
        error_detail=detail,
    )


def pct(vals: list[float], p: float) -> float:
    if not vals:
        return float("nan")
    s = sorted(vals)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (k - lo), 2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8001/scrape")
    ap.add_argument("--zip", dest="zip_code", required=True)
    ap.add_argument("--ladder", default="7,14,30,45,60,90")
    ap.add_argument("--runs", type=int, default=5, help="measured runs per point, after warmup")
    ap.add_argument("--out", default="/root/apollo4/results/window_sizing.jsonl")
    args = ap.parse_args()

    ladder = [int(x) for x in args.ladder.split(",") if x.strip()]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    sink = out.open("a", buffering=1)

    def emit(a: Attempt) -> None:
        sink.write(json.dumps(asdict(a)) + "\n")

    print(f"[apollo4] zip={args.zip_code} ladder={ladder} runs={args.runs} -> {out}", flush=True)
    print(f"[apollo4] ceiling {SCRAPE_TIMEOUT_MS/1000:.0f}s, stop when p90 >= "
          f"{SCRAPE_TIMEOUT_MS/1000*HEADROOM_FRACTION:.0f}s", flush=True)

    summary: list[dict] = []
    baseline_p50: float | None = None
    stop_reason = "ladder complete"

    for past_days in ladder:
        walls: list[float] = []
        statuses: dict[str, int] = {}
        byte_total = 0
        counts: list[int] = []
        aborted = False

        for run in range(args.runs + 1):  # run 0 is warmup
            warm = run == 0
            attempt = one_request(args.url, args.zip_code, past_days)
            attempt.run = run
            attempt.warmup = warm
            emit(attempt)

            key = attempt.error_kind or f"http_{attempt.http_status}"
            statuses[key] = statuses.get(key, 0) + 1

            tag = "warmup" if warm else f"run {run}"
            print(f"  past_days={past_days:>3} {tag:<7} {attempt.wall_s:>7.2f}s "
                  f"status={attempt.http_status} count={attempt.count} "
                  f"{'BLOCKED' if attempt.blocked else ''}{attempt.error_kind or ''}",
                  flush=True)

            if attempt.blocked:
                stop_reason = f"block signal at past_days={past_days}: {attempt.error_kind}"
                aborted = True
                break

            if not warm and attempt.wall_s is not None:
                walls.append(attempt.wall_s)
                byte_total += attempt.bytes_down or 0
                if attempt.count is not None:
                    counts.append(attempt.count)
                # Throttle detector: a run far slower than this point's first
                # measured run. Compares like with like — same ZIP, same window.
                if len(walls) > 1 and walls[0] > 0 and attempt.wall_s > INFLATION_FACTOR * walls[0]:
                    stop_reason = (f"latency inflation at past_days={past_days}: "
                                   f"{attempt.wall_s:.1f}s vs first run {walls[0]:.1f}s")
                    aborted = True
                    break

            time.sleep(GAP_S)

        if walls:
            row = {
                "past_days": past_days,
                "n": len(walls),
                "p50_s": pct(walls, 0.50),
                "p90_s": pct(walls, 0.90),
                "p99_s": pct(walls, 0.99),
                "mean_s": round(statistics.fmean(walls), 2),
                "median_count": int(statistics.median(counts)) if counts else None,
                "bytes_per_run": int(byte_total / len(walls)),
                "status_mix": statuses,
            }
            summary.append(row)
            print(f"  -> past_days={past_days}: p50={row['p50_s']}s p90={row['p90_s']}s "
                  f"count={row['median_count']}", flush=True)

            if baseline_p50 is None:
                baseline_p50 = row["p50_s"]

            if row["p90_s"] >= SCRAPE_TIMEOUT_MS / 1000 * HEADROOM_FRACTION:
                stop_reason = (f"p90 {row['p90_s']}s reached timeout headroom at "
                               f"past_days={past_days}")
                aborted = True

        if aborted:
            break

    print("\n[apollo4] STOPPED:", stop_reason, flush=True)
    print(json.dumps({"zip": args.zip_code, "stop_reason": stop_reason,
                      "points": summary}, indent=2), flush=True)
    sink.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
