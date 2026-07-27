# Crawl Capacity — Results

**Date:** 2026-07-27 · **Plan:** `2026-08-13-crawl-capacity-after-apollo-iii.md`

## The gate was not what the plan assumed

The plan said "raise `WORKER_CONCURRENCY` from 1 toward 5". **That alone would
have been a no-op**, and would have produced the false conclusion that
concurrency does not help.

`ScraperEndpoint.nextStart` is per-**endpoint**, and production has exactly one
endpoint (`SCRAPER_URLS=http://127.0.0.1:8001`). So the pacing gate is
effectively global: N runners all queue behind one interval. Measured before
changing anything:

| | value |
|---|---|
| jobs/hour | 231 |
| spacing between jobs | 15.6 s |
| average job duration | **6.0 s** |
| `interval_ms` (AIMD, at its floor) | 12,000 |

Roughly **9.6 s of every 15.6 s cycle was spent waiting on the gate**, not
working. The gate was the binding constraint; concurrency was not.

## What was measured, stepping against a live source

| config | confirmations/hr | blocks | verdict |
|---|---|---|---|
| **c=1, 12 s** (baseline) | 1,075 | 0 in 24 h / 4,534 jobs | the starting point |
| c=2, 8 s | ~2,000–3,000 (peak bucket 4,236) | **2 in 45 min** | ~2× throughput, at the edge |
| c=3, 5 s | — | **sustained blocking**; AIMD backed 5 s → 20 s | the wall |
| **c=2, 10 s** (settled) | measuring | **0** | shipped, with margin |

Every step was reverted the moment blocks appeared, and the system self-healed:
AIMD backed off automatically and walked back down (20 s → 17 s → 14 s → floor)
with no intervention.

## This corrects Apollo III

Apollo III concluded concurrency 5 / 64.4 req/min was safe, never blocked. That
was measured as a **burst of 20 scrapes per level**. Production is **sustained**
and issues **five passes per ZIP**.

**The sustained ceiling is materially lower than the burst ceiling.** Blocking
began at concurrency 3 with a 5 s interval — well inside what the burst test
called safe.

**A safe burst rate is not a safe sustained rate.** Any future capacity probe
must hold the rate for long enough to matter, not sample it.

## Why the throughput number is not stated precisely

Confirmations per 5-minute bucket ranged **19 to 430** in a single settled
window, because a bucket's value depends entirely on whether the ZIPs being
crawled are dense or sparse. Short windows cannot measure this reliably, which
is why `crawl-throughput.sh` averages over 6 hours.

**The honest claim: the gate moved from 12 s to 10 s with concurrency doubled,
block-free at settled state.** The throughput gain will be readable on the
6-hour meter once it has six hours of the new configuration in it. Claiming a
precise multiple from 10-minute samples would be the kind of number that has
already misled this project twice.

## Configuration, now in code

`WORKER_CONCURRENCY=2` and `SCRAPER_MIN_INTERVAL_MS=10000` are emitted from
`gen-env.sh` with the measurement table above recorded inline — previously they
existed only in prod's `.env`, so the tuning was not reproducible.

## Not done

- **`past_days` unlimited.** Apollo III showed it is ~2× more request-efficient
  (195 rows/req vs 96), so the crawl-capacity objection is withdrawn — but it
  roughly doubles ingest again, and doing that in the same session as a
  concurrency change would make attribution impossible. It should be its own
  staged change against the 6-hour meter.
- **County sweeps for ZIP discovery.** Needs the validated county registry
  (`2026-08-07-incremental-crawl.md` Task 1b) because ~1 in 5 county names
  misresolve silently.
