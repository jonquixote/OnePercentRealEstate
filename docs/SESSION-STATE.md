# Session State — 2026-07-28

Written for continuity across context compaction. Live system state, open work,
and the traps that cost time. `docs/HANDOFF.md` is the durable engineering guide;
this file is the "where we are right now".

## Production is healthy

Box `209.50.61.64`, single host, systemd (not Docker except monitoring).

| signal | value |
|---|---|
| freshness SLO (10 d window) | **99.9%** — 276 unconfirmed |
| 7-day figure (non-alerting target) | **70.5%** — 156,529 outside |
| confirmations | ~3,551/hr (6 h avg) |
| **ZIP sweep** | **1,118 ZIPs / 6 h of 24,676 → ~5.5 d** |
| db-load-budget top query | 14.9% / 38 s — quiet |
| photos / rent bands | 100% / ~91–93%, 0 malformed |
| streams (24 h) | for_sale 15,006 · rentals 11,219 · sold 6,277 |
| failed units · firing alerts | none · none |

Crawl config: `WORKER_CONCURRENCY=2`, `SCRAPER_MIN_INTERVAL_MS=10000`,
`SCRAPE_PAST_DAYS=90`, scraper **1** uvicorn worker, `SCRAPER_URLS` = one local
endpoint.

## The one thing to know before touching the crawl

**Any comparison of crawl metrics across time windows is confounded by ZIP
density.** Job p50 is 6.9 s for a 0-row ZIP and 144.8 s for a 200+ row ZIP — ~20×.
Two conclusions died to this in one session, and a scraper change was shipped on
one of them before it was caught. Normalise by rows returned, or compare the same
ZIP set.

## Plans: done, partial, undone

**Fully executed**
- `2026-07-29-every-listing-has-a-photo` — 100% coverage, probe live
- `2026-07-30-rent-confidence-and-triage` — bands 59.3% → 93%+, zero unexplained failures
- `2026-08-06-apollo-probe-homeharvest` (Apollo I) — findings recorded, one later corrected
- `2026-08-09-apollo-ii` — Tasks 1–3 done; **Task 1 steps 2–3 need the 24 h re-snapshot** (`ops/probe/apollo3/results/t0_*.json` captured)
- `2026-08-10-sustainable-freshness-and-load` — freshness window reconciled, load ~358 s/hr → ~180 s/hr, stats refresh 73 s → 18.5 s
- `2026-08-11-apollo-iii` — concurrency/shape/past_days measured; **Task 2's "shape barely matters" corrected Apollo I**
- `2026-08-12-crawl-observability` — confirmations, ZIP sweep, block rate, stream panel all now measured

**Partially executed**
- `2026-08-07-incremental-crawl` — Task 1 done (`past_days=90` live). **Task 1b (county registry validation) is a hard prerequisite** — ~1 in 5 county names misresolve silently. Tasks 2–4 open.
- `2026-08-02-make-active-mean-something` — Tasks 1/3/4 shipped; Task 2 invalidated
- `2026-08-03-cold-listings-archival` — table, read-through and resurrection shipped; **zero rows moved**
- `2026-08-13-crawl-capacity` — concurrency raised, but **its central result was withdrawn as confounded**

**Not started**
- `2026-08-05-indexability-and-honest-urls` — `/property/<bad-id>` still returns **200**, sitemap advertises unconfirmed listings
- `2026-08-08-the-stash` — Task 1 (compression) measured and **declined**; **the stash rule still selects zero rows** (no listing has `last_seen_at` older than 30 days — find out why first)
- `2026-08-14-zip-sweep-fairness` — **new, and the highest-value open work**
- `2026-08-15-density-normalized-measurement` — **new, gates all further crawl tuning**

**Superseded**
- `2026-08-04-crawl-yield-scheduling` — ⛔ do not execute
- `2026-07-31-image-weight-and-durability` — Tasks 2–3 cancelled on measurement; Task 4 (CDN probe) shipped

## What to do next, in order

1. **`2026-08-14-zip-sweep-fairness`.** 5,345 of 24,676 active ZIPs (21.7%) went
   uncrawled for seven days while others were hit 9–12 times. Those listings can
   never be confirmed — this is why the 7-day figure is pinned near 70%. Nothing
   else moves it.
2. **`2026-08-15-density-normalized-measurement`.** Until this exists, no crawl
   change can be evaluated. `WORKER_CONCURRENCY=2` is live and **nobody knows if
   it helps**; it sits closer to the source's block threshold (which is 3) than
   concurrency 1 does.
3. **`past_days` unlimited** — Apollo III showed it is ~2× *more* request-efficient
   (195 rows/req vs 96). Deliberately deferred: changing ingest while the
   measurement methodology is broken would produce another confounded result.
4. Then: county registry validation, the stash rule, indexability, archival.

## Traps that have already cost time

- **Never `scp` into `/opt/onepercent`** — it blocks `git pull --ff-only` and the box silently freezes at an old commit while deploys appear to succeed. Cost hours; I repeated it once after documenting it.
- **`gen-env.sh` regenerates `/etc/oper.env` on every deploy** — set values in the source `.env`, and deny-list anything emitted explicitly or it appears twice.
- **`CREATE TABLE (LIKE x INCLUDING DEFAULTS)` does not copy generated columns** — `SELECT *` between `listings` and `listings_archive` fails and took the crawl down for 80 minutes.
- **A probe must cost less than what it protects** — one seq-scanned 11 GB for 9.65 s twice an hour.
- **AIMD resets to 30 s on every worker restart** and takes ~10–15 min to reach its floor; short post-restart windows understate throughput.
