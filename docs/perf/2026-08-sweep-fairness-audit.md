# Sweep Fairness Audit — the scheduler is fair; the sweep is too slow

**Date:** 2026-07-28 · Task 1 of `docs/superpowers/plans/2026-08-14-zip-sweep-fairness.md`
**Verdict:** the plan's premise is **falsified**. There is no starvation bug. Task 2 as written would change nothing.

## What the plan assumed

> "Find out why the scheduler is uneven … 5,345 active ZIPs went uncrawled for a
> full week while others were crawled 9–12 times."

The implied mechanism was an unfair **selection rule** — that some ZIPs are
invisible to the enqueue, or lose repeatedly to denser ones. Task 2 therefore
proposed least-recently-swept ordering with `NULLS FIRST` in
`RECHECK_ENQUEUE_SQL`.

Every part of that mechanism is wrong.

## What is actually running

There are two enqueue paths, and the plan named the wrong one.

**`zip_recheck`** (`RECHECK_ENQUEUE_SQL`, `apps/worker/src/lifecycle.ts:77`)
selects ZIPs holding `pending_verify` rows, `ORDER BY count(*) DESC`, `LIMIT $1`.
It *is* biased toward dense ZIPs — and it is irrelevant at this scale:

| | |
|---|---|
| `zip_recheck` rows ever created | **1,120** |
| distinct ZIPs they touch | **221** |
| `zip_code` rows | **95,798** |

`zip_recheck` is 1.2% of the queue. Rewriting its ordering cannot move a
national coverage number.

**`zip_code`** — the path that does all the work — is a **static seeded backlog
drained in strict `id` order** (`claimJobOfKind`, `crawl.ts:120`,
`ORDER BY id … FOR UPDATE SKIP LOCKED`). The seed was run three times, and the
row ids form three exact, contiguous, non-overlapping blocks:

| block | ids | rows |
|---|---|---|
| 1st visit per ZIP | 14 – 31,926 | 31,913 |
| 2nd | 31,927 – 63,839 | 31,913 |
| 3rd | 63,840 – 95,752 | 31,913 |

Every ZIP appears exactly once per block (60 ZIPs have a 4th row). Claiming in
`id` order therefore executes **three identical sequential sweeps of the same ZIP
list in the same order**. `pending` today is one unbroken range, 57,328–93,075,
with `processing` sitting at exactly 57,327 — the head of it.

**That is a perfect round-robin.** Every ZIP is visited exactly once per sweep,
in a fixed order, and no ZIP can be passed over. The scheduler is not uneven.

## So where did "5,345 starved" come from?

They are in the queue, waiting their turn:

| the 5,353 active ZIPs unswept in 7 days | |
|---|---|
| **queued `pending` — simply not reached yet** | **5,345** |
| has a row but not pending | 2 |
| **no job row at all — genuinely absent** | **6** |

The starvation is 6 ZIPs, not 5,345. The rest is a queue position.

The plan also predicted the starved set would be systematically low-volume,
which would have meant starving the deal-richest markets. It is the opposite —
they are **denser** than the swept ones:

| | ZIPs | active listings | avg/ZIP |
|---|---|---|---|
| swept in 7 d | 19,329 | 394,838 | 20.4 |
| not swept in 7 d | 5,351 | 137,399 | **25.7** |

Nothing is being selected against. The sweep front simply had not arrived.

And the "9–12 times" comparison, measured properly over the same 7 days:

| visits | ZIPs |
|---|---|
| 1 | **25,056** |
| 2 | 88 |
| 3–8 | 37 |
| 9–15 | **69** |

69 ZIPs of 25,250. True, and immaterial — it is the `zip_recheck` path, and it
consumes ~1% of capacity.

## The real mechanism, measured the way the methodology rule demands

Not an aggregate across a window — the **same-ZIP** interval between consecutive
finishes, over 34,116 observed revisits:

| ZIP revisit interval | |
|---|---|
| **p50** | **8.82 days** |
| **p90** | **12.69 days** |

**The sweep period exceeds the 7-day window.** That is the whole finding. A
listing in a ZIP visited every 8.8 days cannot be under 7 days old half the
time, so 7-day freshness is pinned near 70% by arithmetic, and no reordering of
a fair round-robin changes it. The 10-day SLO reads 99.9% because 10 days sits
above the p50 and near the p90.

This also corrects `2026-08-zip-sweep-is-the-metric.md`, which inferred a
~5.5-day sweep from an aggregate (ZIPs/hour ÷ total ZIPs). The aggregate
understated it by 60%: it counted `zip_recheck` revisits of 221 ZIPs as sweep
progress, and it assumed a rate that a 10-day mean does not sustain.

## Why the sweep is slow, and what the constraint actually is

Over the 22.6 hours where `duration_ms` exists (column added 2026-08-12):

| | |
|---|---|
| jobs completed | 5,366 |
| **achieved** | **237 jobs/hr** |
| pacing gate ceiling (`SCRAPER_MIN_INTERVAL_MS=10000`, one endpoint) | 360/hr |
| runner-bound ceiling (2 runners ÷ 18.0 s avg) | 400/hr |
| runners actually busy | **59.3%** of 2-runner capacity |

Runners are idle 41% of the time and the configured gate is not saturated
either, so the binding constraint is the **AIMD-adjusted interval** — the
effective gate sits near 15 s, which predicts 240/hr against 237 observed.

**The gated unit is a job start, not a second.** That distinction decides the fix,
and it is the mirror of the density confound: measured in seconds the cheap jobs
look negligible; measured in the unit that is actually rationed they are a third
of the budget.

| jobs on ZIPs with… | jobs | **% of job starts** | runner-seconds | % of time | confirmations |
|---|---|---|---|---|---|
| active for-sale inventory | 3,743 | 69.8% | 24.5 h | 91.4% | **73,620** |
| **no active for-sale inventory** | 1,621 | **30.2%** | 2.3 h | 8.6% | **211** |

**30% of the rationed resource returns 0.3% of the confirmations.**

7,239 of the 31,913 seeded ZIPs have no active for-sale listing. Of those, 337
have ever produced a rental and 902 a sold record — so roughly 4,300 have never
yielded anything in any stream.

## Recommendation — one fix

**Tier the sweep by yield; do not reorder it, and do not drop anything.**

Keep the round-robin exactly as it is — it is already fair, and fairness is not
the problem. Give ZIPs that have never yielded a slower cadence (e.g. one visit
in every third sweep) so the productive sweep completes faster.

Expected effect, as arithmetic: removing ~30% of job starts from each sweep
takes the p50 revisit interval from **8.8 days to ~6.2 days**, which crosses the
7-day window. Nothing else available on one egress IP does that — the source
blocks at concurrency 3, and confirmations/hour is already 163% of the 10-day
requirement.

Three constraints on the implementation:

1. **Demote, never drop.** 237 of 1,621 no-inventory jobs (14.6%) returned rows
   anyway. A quiet ZIP is not a dead one, and a ZIP that gains its first listing
   must still be found — a demoted ZIP that yields must return to full cadence.
2. **Do not touch `RECHECK_ENQUEUE_SQL`.** It is 1.2% of the queue and not the
   mechanism. Changing it would be a change made to the wrong file for a reason
   that has been disproved.
3. **Fix the recycle trigger's blast radius first.** `recycle_crawl_jobs()`
   (`infrastructure/job_recycle_trigger.sql`) fires when `pending` and
   `processing` both reach 0 and sets `finished_at = NULL` on **all 95,798 rows**.
   Every throughput and sweep probe filters on `finished_at`, so the moment the
   backlog completes — about 8 days out at the current rate — the entire crawl
   history is erased in one statement and every probe goes blind at once. This
   has never fired; `pending` has never reached 0.

## What this audit does not claim

Whether `WORKER_CONCURRENCY=2` helps remains unmeasured, exactly as
`2026-08-zip-sweep-is-the-metric.md` records. The 59.3% runner utilisation above
is consistent with either answer and is not offered as evidence for one.
`2026-08-15-density-normalized-measurement` is still owed.
