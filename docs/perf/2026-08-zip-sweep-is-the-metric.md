# ZIP Sweep Interval Is the Metric — Not Confirmations/Hour

**Date:** 2026-07-28 · Follows `2026-08-crawl-capacity-results.md`

## The concurrency change moved the wrong number

Measured over 30 hours, split at the change:

| period | jobs/hr | **ZIPs/hr** | confirmations/hr | avg job duration |
|---|---|---|---|---|
| BEFORE (c=1, 12 s) | 262 | **262** | 2,125 | 7,219 ms |
| AFTER (c=2, 10 s) | 251 | **249** | 3,341 | **17,491 ms** |

Confirmations rose 57%. **ZIP coverage fell slightly.** Job duration went up
**2.4×**, almost exactly cancelling the added parallelism: 2 runners ÷ 17.5 s
predicts 238 jobs/hr, and 251 was observed.

The confirmations gain came from more rows per visit, not more visits.

## Why that matters: freshness is governed by sweep interval

Active listings by age, and where the mass sits:

| age | listings |
|---|---|
| 0–1 d | 54,538 |
| 1–3 d | 99,243 |
| 3–7 d | **218,879** |
| **7–10 d** | **161,070** |
| 10 d+ | 5,629 |

At ~250 ZIPs/hour against **24,917 active ZIPs**, one full sweep takes
**~4.2 days** — and with variance the tail lands in the 7–10 day band. That is
the entire shape of the distribution.

**Confirming more listings per ZIP does not move freshness at all.** The same
ZIPs are visited at the same rate; each visit just returns more rows. This is
why 7-day freshness *fell* (72.0% → 68.9%) during a period when
confirmations/hour rose 57%.

`ops/monitoring/crawl-throughput.sh` measures confirmations/hour, which conflates
"more rows per visit" with "more visits". **For freshness, ZIPs/hour is the
metric.**

## ⚠️ CORRECTION (same day): the duration analysis below was confounded

The claim that "job duration went up 2.4×, cancelling the parallelism" **does
not survive scrutiny**. Job duration is dominated by ZIP density, not by
concurrency. Measured over 3 hours:

| rows returned by the job | n | p50 duration |
|---|---|---|
| 0 rows | 140 | 6,934 ms |
| 1–49 | 371 | 12,099 ms |
| 50–199 | 99 | **52,375 ms** |
| 200+ | 2 | **144,795 ms** |

**A dense ZIP takes ~20× longer than an empty one.** The BEFORE window averaged
**11 rows/job**; the AFTER window averaged **18**. Duration scaled with density
exactly as this table predicts — the concurrency change is not what moved it.

A follow-up test made this unmistakable: adding a second uvicorn worker to the
scraper appeared to make p50 collapse to 39.8 s and then 70.5 s. It was reverted
— and after the revert the box went to **75% idle, 0% iowait, load 0.47** with
jobs still slow, because the crawler had simply moved onto denser ZIPs. The
transient 31.5% iowait attributed to DB contention was not reproducible either.

**Methodological rule for all future crawl work: any comparison of crawl metrics
across time windows is confounded by ZIP density.** Normalise by rows returned,
or compare the same ZIPs, or the numbers mean nothing. Three conclusions in this
session were reached from unnormalised window comparisons; this is the second to
fall.

### What still stands

- **ZIP sweep interval, not confirmations/hour, governs freshness.** The age
  distribution matches the ~5.4-day sweep exactly. That reasoning is
  density-independent.
- **ZIP coverage did not improve** (262 → 249/hr). Whatever the mechanism, the
  concurrency change did not buy sweep rate.
- **The source blocks at concurrency 3** from one IP — measured directly, with
  AIMD backing off, and reproducible.

### What must be re-measured

Whether `WORKER_CONCURRENCY=2` helps at all, using a density-normalised
comparison (e.g. duration per row returned, or the same ZIP set before and
after). Until then, neither "it helped" nor "it was cancelled out" is supported.

## Why concurrency cannot be pushed further on this box

The chain, each link measured:

1. **The pacing gate no longer binds.** At a 10 s interval it permits 360
   jobs/hr; we do 251.
2. **Job duration binds.** 7.2 s → 17.5 s when concurrency went 1 → 2.
3. **Duration doubled because the scraper serializes.** It runs
   `uvicorn services.scraper_service.main:app` with **no `--workers` flag — one
   worker** — and `scrape_listings` is a synchronous `def`, so homeharvest and
   pandas work is GIL-bound. The box has **2 cores** and sat **87% idle**, so
   this is contention, not saturation.
4. **But adding scraper workers will not help**, because the *source* is the
   next limit: `2026-08-crawl-capacity-results.md` measured sustained blocking at
   concurrency 3 from a single IP, with AIMD backing 5 s → 20 s.

**So the box is at its useful ceiling.** More local parallelism would either
serialize on the GIL or trip the source.

## The only remaining lever is more egress

Each additional scraper node brings its own IP and therefore its own concurrency
budget. Apollo III confirmed the limit is **per-IP, not account-level** — prod
recorded 0 blocked of 108 jobs while a second IP pushed 64 req/min.

This is exactly what the idle nodes and the stateless-nodes work (PR #85) are
for, and it is now the single highest-value crawl change available.

**Expected effect, stated as arithmetic rather than hope:** ZIP coverage scales
roughly linearly with egress. Two nodes ≈ 500 ZIPs/hr ≈ a **2.1-day** sweep;
three ≈ 750/hr ≈ **1.4 days**. A 7-day freshness target needs ~148 ZIPs/hr
*sustained* — already met — but the 7-day *distribution* needs the sweep interval
comfortably under 7 days, which one node at 4.2 days achieves only when nothing
goes wrong.

## What to do with the concurrency setting

Leave `WORKER_CONCURRENCY=2` at a 10 s gate. It is block-free and costs nothing —
confirmations are genuinely higher even though ZIP coverage is flat, which means
more listings per visit are being refreshed. But **it should not be credited with
a freshness improvement**, and pushing it to 3 is known to trip the source.
