# Crawl Capacity — the plan that should go AFTER Apollo III

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the freshness gap — 1,898 confirmations/hour against the 3,267 a 7-day sweep needs — using whatever Apollo III proves is safe.

**Why after Apollo III:** this plan's central parameter is the safe concurrency
level, and that number does not exist yet. Writing it now would repeat the
mistake of `2026-08-04-crawl-yield-scheduling.md`, which was written on an
assumption and superseded before a line of it ran.

> ## ✅ UNBLOCKED — Apollo III returned (2026-07-27)
>
> The missing parameter now exists. `docs/perf/2026-08-apollo3-findings.md`:
>
> - **Safe concurrency is 5** — 64.4 req/min, **2.25× serial**, never blocked up
>   to 8, and level 8 buys nothing over 5.
> - **The limit is per-IP.** Prod recorded 0 blocked of 108 jobs while a second
>   IP pushed 64 req/min, so the multi-node branch below stays viable.
> - **Query shape is NOT the lever.** Every shape lands at 4,000–4,800 rows/min;
>   Apollo I's "county is 100× faster" compared a raw scrape rate against an
>   end-to-end job rate. The county branch below is therefore for **ZIP
>   discovery only**, not throughput.
> - **Unlimited `past_days` is ~2× more request-efficient**, so it should be
>   folded in rather than treated as a cost.
>
> Projected: 1,978 confirmations/hr → **~4,450 at concurrency 5**, clearing both
> the 10-day (2,289) and 7-day (3,267) requirements. **That is a projection from
> request rate, not a measurement of confirmations through our pipeline** — the
> first task must be to raise concurrency one step at a time and measure against
> `ops/monitoring/crawl-throughput.sh` after each.

## Shape, conditional on Apollo III's findings

- **Raise `WORKER_CONCURRENCY` from 1 toward 5, one step at a time**, measuring
  confirmations/hour on the 6-hour average after each step and watching
  `crawl_jobs.blocked` (structured, never a log grep). This is now the primary
  path: the capacity exists, it is proven safe, and it needs no new hardware.
  **Stop at the first structured block signal**, and note that raising OUR
  concurrency is not identical to the probe's — production also runs five passes
  per ZIP and writes to the database, so the 2.25× may not carry over intact.
- **More egress remains available if concurrency alone falls short.** The idle
  scraper nodes and the stateless-nodes work (PR #85) are viable — Apollo III
  confirmed the limit is per-IP, not account-level.
- **County sweeps: adopt for ZIP DISCOVERY only.** Apollo III measured them at
  4,811 rows/min against ZIP's 4,824 — no throughput gain. They still enumerate
  ZIPs we have never seen, which ZIP scheduling structurally cannot, and they
  still need the validated county registry (`2026-08-07-incremental-crawl.md`
  Task 1b) because ~1 in 5 names misresolve silently.
- **Go unlimited on `past_days`.** Apollo III measured 195 rows/request at
  unlimited against 96 at 30 days — roughly **2× more efficient per request**,
  not less. The remaining risk is downstream ingest (rent queue, disk), which is
  what the staged rollout was always for.

## Hard constraints carried forward

- **No stream may be starved.** `for_sale` 9,419 new rows/day,
  `rental_listings` 8,276, `sold_listings` 7,536 — all comparably productive.
  This is what refused Task 4 of the freshness plan and it still holds.
- **No threshold widened to make a number look better.**
- Every step measured against the confirmations/hour meter, before and after.
