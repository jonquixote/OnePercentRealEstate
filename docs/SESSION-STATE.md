# Session State — 2026-07-31 (SERVER MIGRATED)

## ⚠️ Prod moved to `209.94.60.174`

The old box `209.50.61.64` was **shut down on an expired UpCloud trial** and is
**unrecoverable** — its disk and backups survive in that account, but every write
returns `TRIAL_PERIOD_OVER (403)`, so it cannot be started, cloned or exported.
`upctl` is still authenticated to that dead account and **cannot manage the new
box** (different account).

| | old | new |
|---|---|---|
| host | `209.50.61.64` | **`209.94.60.174`** (`one-percent-prod-main`) |
| cores / RAM / disk | 2 / 16 GB / 150 GB | **12 / 23 GB / 1008 GB** |
| OS | Ubuntu 24.04 | **Ubuntu 26.04** |

```
ssh -i ~/.ssh/id_onepercent root@209.94.60.174
```

Recovery came from **Cloudflare R2**, not UpCloud: `postgres-2026-07-30.dump`
restored clean (91 tables, 1.42M listings, 3.52M history, 678k rentals, 204k
sold). Max data loss ≈ 24 h of crawl, which the sweep re-derives.

**One IP now, deliberately** — capacity was traded for egress. That does not
speed the crawl: the limit is the source's per-IP tolerance (blocks at
concurrency 3) and the 10 s pacing gate, so `WORKER_CONCURRENCY` stays at **2**.
The extra cores help Postgres, ML and restores.

**Provisioning traps, all now fixed in the repo** (PR #95): `pg_tileserv` was
fetched by `docker cp` from a container that no longer exists; Postgres came up
on stock defaults because the old tuning lived only in its `postgresql.conf`;
Redis shipped `daemonize yes` and silently exited; two units fought over one
`PGDATA`; nginx lacked the `$connection_upgrade` map. See
`ops/db/postgresql-tuning.conf` and [[postgres-cgroup-memory]] — **size
`shared_buffers` against the unit's cgroup `MemoryHigh`, not physical RAM.**

---

# Session State — 2026-07-30

Written for continuity across context compaction. Live system state, open work,
and the traps that cost time. `docs/HANDOFF.md` is the durable engineering guide;
this file is the "where we are right now".

## Production is healthy — and the sweep problem is solved

Box `209.50.61.64`, single host, systemd (not Docker except monitoring).

| signal | value | vs pre-fix (07-28) |
|---|---|---|
| freshness SLO (10 d window) | **99.9%** | = |
| **7-day freshness** | **91.2%** | **70.5%** |
| confirmations | **~6,486/hr** (24 h) | ~3,551 |
| **full seeded ZIP sweep** | **~4.2 d** (317 jobs/hr, 31,913 ZIPs) | ~8.8 d |
| job duration p50 / p90 | **5.2 s / 8.2 s** | 18.5 / 108 |
| timeouts (24 h) | **0** | 31/6h |
| active ZIPs unswept 7 d | **516** (507 queued, 5 no row) | 5,353 |
| db-load-budget | quiet | |
| failed units · firing alerts | none · none | |

**What fixed it:** the dense-ZIP tail was our own geocoder, not the source
(`f82074b`, PR #91). The scraper re-geocoded every row through a sequential
Nominatim fallback (~1.1 s/address) although the source supplies coordinates on
97.3% of rows. Source coords now win. Deployed 07-28 08:23 UTC; two-day outcome
above confirms it. The crawl is now **gate-bound** (job-start gap p50 11.3 s
against the 10 s `SCRAPER_MIN_INTERVAL_MS` floor), not duration-bound — the
healthy regime.

The `2026-08-14-zip-sweep-fairness` cold-ZIP tiering is **not needed**: sweep is
4.2 d, comfortably under the 7-day target, without it.

Crawl config: `WORKER_CONCURRENCY=2`, `SCRAPER_MIN_INTERVAL_MS=10000`,
`SCRAPE_PAST_DAYS=90` (**inert** — see the past_days provenance note),
scraper **1** uvicorn worker, `SCRAPER_URLS` = one local endpoint.

## Four cleanups — done 2026-07-30 (PR #92 + d5edd1a)

1. **Seed gap fixed.** 5 active ZIPs never in the backlog → idempotent backfill
   (`2026_08_16_seed_unseen_active_zips.sql`), unseen 5 → 0. Not a lifecycle step
   (distinct scan is ~13 s).
2. **Geocoders diagnosed — not dead.** Census/Nominatim resolve normal addresses
   fine; they miss new-construction/rural addresses absent from TIGER/OSM (77493,
   which I'd watched, is new-construction — that's why it looked dead). My earlier
   "User-Agent silent refusal" guess was **wrong**. Real waste was the sequential
   1.1 s/address Nominatim sleep on hopeless lookups; capped at 15/scrape
   (`MAX_NOMINATIM_FALLBACK`), since 16+ batches resolve ~1%.
3. **County registry validation — DEFERRED** (user's call). Not a cleanup:
   ~6,300 source requests needing a disposable IP, and a prerequisite for county
   sweeps that aren't built and whose value dropped now freshness is solved.
   Revisit when county sweeps are on the roadmap + a disposable IP is available.
4. **Honest indexability shipped** (`2026-08-05` plan). Missing property →
   `noindex` (200 not 404 — documented Next streaming limit, see
   `docs/perf/2026-08-indexability-decision.md`); sitemap advertises only
   listings confirmed within 10 d; stale listings `noindex,follow`; one
   `SEO_FRESHNESS_DAYS=10` threshold drives both so they can't contradict; new
   `oper-sitemap-honesty.timer` probe (fire/resolve proven).

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

**Done — the sweep resolution**
- `2026-08-14-zip-sweep-fairness` — Task 1 audit **falsified the plan's premise**
  (the scheduler is a fair round-robin; the 5,345 were queue-position, not
  starvation). The real cause was the geocoder (see PR #91). Sweep 8.8 d →
  4.2 d, 7-day freshness 70.5% → 91.2%. Cold-ZIP tiering (Task 2) **not needed**.

**Done — indexability**
- `2026-08-05-indexability-and-honest-urls` — all 4 tasks shipped 2026-07-30.
  Missing → noindex; sitemap 10-day filter; stale → noindex; honesty probe.

**Not started**
- `2026-08-08-the-stash` — Task 1 (compression) measured and **declined**; **the stash rule still selects zero rows** (no listing has `last_seen_at` older than 30 days — find out why first)
- `2026-08-15-density-normalized-measurement` — gates all further crawl tuning; still owed
- `2026-08-07` Task 1b (county registry validation) — **deferred by decision** (disposable IP + no consumer yet)

**Superseded**
- `2026-08-04-crawl-yield-scheduling` — ⛔ do not execute
- `2026-07-31-image-weight-and-durability` — Tasks 2–3 cancelled on measurement; Task 4 (CDN probe) shipped

## What to do next, in order

The crawl freshness problem is **solved**; remaining work is elsewhere.

1. **`2026-08-15-density-normalized-measurement`.** Still the methodology gate for
   any future crawl tuning. `WORKER_CONCURRENCY=2` remains unproven — though the
   crawl is now gate-bound, so concurrency is no longer the active lever.
2. **County registry validation** (`2026-08-07` Task 1b) — ~1 in 5 county names
   misresolve silently; hard prerequisite for incremental crawl.
3. **`2026-08-05-indexability`** — `/property/<bad-id>` returns 200; product-facing.
4. **`2026-08-08-the-stash`** — rule still selects zero rows; diagnose first.
5. Small crawl cleanups: diagnose the dead geocoders, seed the 5 missing ZIPs.

## Traps that have already cost time

- **Never `scp` into `/opt/onepercent`** — it blocks `git pull --ff-only` and the box silently freezes at an old commit while deploys appear to succeed. Cost hours; I repeated it once after documenting it.
- **`gen-env.sh` regenerates `/etc/oper.env` on every deploy** — set values in the source `.env`, and deny-list anything emitted explicitly or it appears twice.
- **`CREATE TABLE (LIKE x INCLUDING DEFAULTS)` does not copy generated columns** — `SELECT *` between `listings` and `listings_archive` fails and took the crawl down for 80 minutes.
- **A probe must cost less than what it protects** — one seq-scanned 11 GB for 9.65 s twice an hour.
- **AIMD resets to 30 s on every worker restart** and takes ~10–15 min to reach its floor; short post-restart windows understate throughput.
