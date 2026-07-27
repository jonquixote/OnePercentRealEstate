# Apollo III — Findings

**Date:** 2026-07-27 · **Plan:** `2026-08-11-apollo-iii-concurrency-and-shape.md`
**Egress:** 76.33.69.147 (operator-confirmed disposable). Prod `209.50.61.64` untouched.
**Mission status:** Task 1 complete, **never blocked**.

## Task 1 — concurrency is safe, and it is the lever

Apollo I and II both ran strictly serially and both flattened at ~28 req/min.
That was **our latency bound, not the source's limit**. Ramping concurrency:

| concurrency | achieved req/min | vs serial | blocked |
|---|---|---|---|
| 1 (serial) | **28.6** | 1.00× | no |
| 2 | 44.9 | 1.57× | no |
| 3 | 56.8 | 1.99× | no |
| **5** | **64.4** | **2.25×** | no |
| 8 | 63.2 | 2.21× | no |

**Never blocked at any level.** 20 scrapes per level, 60 s between levels.

Two things this settles:

1. **Concurrency 1 reproduced Apollo II's 28.6 req/min exactly**, which
   validates the method — the two missions measured the same thing the same way.
2. **Throughput plateaus at concurrency 5.** Level 8 is no faster than level 5
   (63.2 vs 64.4), so the ceiling from ~5 onward is not our client. Going beyond
   5 buys nothing and only raises block risk.

**Safe operating concurrency: 5**, for **64.4 req/min ≈ 3,864 req/hour**.

### The limit is per-IP, not account-level

Checked during the ramp, using the structured `crawl_jobs.blocked` column added
by the observability work rather than a log grep:

```
prod blocked jobs during ramp: 0 of 108
crawl-health: passing
```

Production was unaffected while a second IP pushed 64 req/min. **Multi-node
plans remain viable** — if the limit had been account-level, every one of them
would have been void.

## What this means for the freshness gap

Measured on the new confirmations meter, production currently sustains
**1,978 confirmations/hour (6-hour average) = 86.4%** of the 2,289/hr needed for
a 10-day sweep.

Production runs `WORKER_CONCURRENCY=1`. At the measured 2.25× from concurrency 5:

| | confirmations/hour | 10-day requirement (2,289) | 7-day requirement (3,267) |
|---|---|---|---|
| today (serial) | 1,978 | 86% | 61% |
| **projected at concurrency 5** | **~4,450** | **194%** | **136%** |

**If the 2.25× carries over, concurrency 5 clears both requirements** — including
the 7-day target that the freshness work concluded could not be reached by any
cheap lever.

**This is a projection, not a measurement.** The ramp measured *requests* per
minute against a source; it did not measure *confirmations* per hour through our
full pipeline, which also involves the upsert, the once-per-day `last_seen_at`
bound, and five passes per ZIP. The capacity plan must raise concurrency in
steps and measure confirmations after each, against the meter that now exists.

## Task 2 — shape barely matters, and this corrects Apollo I

| shape | rows | wall | est. req | **rows/min** | rows/req |
|---|---|---|---|---|---|
| ZIP 44120, `past_days=90` (as prod) | 182 | 2.3 s | 1 | **4,824** | 182 |
| ZIP 44120, unlimited | 252 | 3.3 s | 2 | **4,571** | 126 |
| Cuyahoga County, full | 5,484 | 68.4 s | 28 | **4,811** | 196 |
| Cuyahoga County, `updated_in_past_hours=24` | 148 | 2.3 s | 1 | **3,810** | 148 |

**Every shape delivers roughly 4,000–4,800 rows/minute.** The county sweep is
*not* dramatically faster per unit of time; it simply returns more rows in one
call.

### Correcting Apollo I

Apollo I concluded a county sweep was ~100× more efficient than ZIP recheck,
from "county full = 4,462 listings/minute vs ZIP recheck ~45 listings/minute".

**That comparison was invalid.** The 4,462 was a *raw scrape rate*; the 45 came
from production job durations (7.6 minutes for 345 listings), which include all
five passes, inter-pass jitter, block cool-offs and database writes. Raw scrape
throughput against end-to-end production throughput — apples to oranges.

Measured on the same axis, ZIP and county are within ~5% of each other. **The
crawl's bottleneck is not the query shape.** It is passes per ZIP, pacing, and
serial execution — and Task 1 showed the last of those is worth 2.25×.

This does not retire county sweeps: they still enumerate ZIPs we have never
seen, which ZIP-shaped scheduling structurally cannot. But they should be
adopted for **discovery**, not for a throughput gain that does not exist.

## Task 3 — wider `past_days` is MORE request-efficient, not less

| `past_days` | rows | est. req | **rows per request** |
|---|---|---|---|
| 30 | 96 | 1 | **96** |
| 90 (current prod) | 271 | 2 | **136** |
| unlimited | 586 | 3 | **195** |

The plan expected two opposing effects — more inventory (good) against more
requests per ZIP (bad). **The second effect does not materialise.** Rows per
request *improves* monotonically with a wider window, because a denser result
set fills the library's 200-row pages more completely; a narrow window wastes
most of a page.

**Unlimited is roughly 2× more request-efficient than `past_days=30`** while also
returning ~6× the inventory.

This answers the rollout question left open in
`docs/perf/2026-08-past-days-rollout.md`: **going unlimited costs less per
confirmed listing, not more.** The remaining risk is downstream ingest volume —
the rent queue and disk — not crawl capacity.

## Method note

Raw per-level records in `ops/probe/apollo3/results/concurrency.jsonl`. Block
detection covered 403/forbidden/authentication/429/captcha/challenge on the
exception text; zero matched at any level.
