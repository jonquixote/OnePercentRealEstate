# Freshness & Load — Results

**Date:** 2026-07-27 · **Plan:** `2026-08-10-sustainable-freshness-and-load.md`

## Task 1 — freshness window reconciled

| | before | after |
|---|---|---|
| SLO window | 7 days (probe) vs 10 days (reaper) — **inconsistent** | 10 days, derived from `STALE_AFTER_DAYS` |
| reported | 73.1% confirmed, 147,647 unconfirmed | **99.5% confirmed, 2,505 unconfirmed** |
| 7-day figure | (was the alert) | 73.0% — retained, **non-alerting** |

Verified against arithmetic rather than accepted: predicted ~2,339 rows outside
10 days (~99.6%); measured 2,427 then 2,505 (99.6% → 99.5%). The analysis held.

**This did not make the crawl faster and is not presented as though it had.**
The 7-day figure is still 73.0% and still visible.

## Task 2 — probes now cost less than what they protect

| probe | before | after |
|---|---|---|
| band integrity query | Parallel Seq Scan, **9,306 ms** | Index Only Scan, **0.057 ms** |
| `rent-coverage.sh` end-to-end | 9.65 s | **1.77 s** |

Count identical (0) both ways. The partial index's predicate *is* the violation,
so it indexes only already-broken rows — normally none.

The other coverage queries were already index-backed; their 2–4 s is inherent in
aggregating 550k+ rows, so cadence was the lever: `rent-coverage` and
`photo-coverage` 30 min → hourly.

## Task 3 — background cadence matched to how fast the data moves

| job | before | after | saving |
|---|---|---|---|
| `stats-refresh` | 30 min (~160 s/hr) | 60 min | **~80 s/hr** |
| MV refreshes | 30 min (~156 s/hr) | 60 min | **~78 s/hr** |
| `rent-coverage` | 30 min (19.3 s/hr) | 60 min + index | **~17.5 s/hr** |
| `photo-coverage` | 30 min (5.7 s/hr) | 60 min | ~2.9 s/hr |

**~358 s/hour → ~180 s/hour**, roughly half, with no probe losing an assertion
and no user-visible latency change (all served through `cachedSWR`).

Justification measured, not assumed: the headline number drifted 585,575 →
585,313 between readings — **0.04%**. Refreshing a figure that moves 0.04% twice
an hour does not earn 160 s/hour.

**Verified the alert is quieter, not broken.** An injected expensive query was
still flagged at 63.5% / 265 s.

### Not done, because measurement said no

Hoisting `is_rentable` out of `api/featured` — the optimisation that took the
stats aggregate from 25.7 s to 9.5 s. Measured here: **12.3 s → 25.3 s, twice as
slow.** In the stats query the CTE rode a scan that was already happening; in
`featured` the `DISTINCT` subquery *adds* one. The optimisation does not
generalise. Reverted before shipping.

## Task 4 — NOT EXECUTED. Premise falsified.

The plan proposed rebalancing crawl passes toward `for_sale`, on the theory that
the other streams were cheaper to defer. Measured daily production:

| stream | new rows / 24 h |
|---|---|
| `listings` (for_sale) | 9,419 |
| `rental_listings` | 8,276 |
| `sold_listings` | 7,536 |

**All three are comparably productive.** Rebalancing would trade ~8,000 rental
comps and ~7,500 sold comps a day — feeding the rent model and sold comps — for
freshness on `listings`. That is precisely the quality-for-metric trade this
plan's constraints forbid.

**Freshness throughput cannot be bought by starving another stream.** It needs a
more efficient crawl shape, which is `2026-08-07-incremental-crawl.md`: Apollo
measured a full county sweep returning 5,354 listings in 72 s (≈4,462
listings/minute) against ZIP recheck's ~45 listings/minute.

## What is still short

| | value |
|---|---|
| confirmations needed for a **7-day** sweep | 3,267 / hour |
| confirmations achieved | ~1,898 / hour |
| | **58% of required** |

The 10-day SLO is met at 99.5%. The 7-day target is not, and the only honest way
to reach it is the incremental crawl work — not a threshold change and not
starving another data stream.


---

## Follow-up: the stats refresh, one scan instead of four (2026-07-27)

Task 3 halved the refresh *cadence*, but the alert kept firing at **46.9% / 73 s**.
Cadence was the wrong lever — the work itself was four times larger than it
needed to be.

The strategy parameter was used **only** in the `resolve_rule()` lookup. The
585k-row scan, the ratio arithmetic and the histogram are identical across all
four strategies, so the refresh scanned the same rows four times to vary a
handful of per-property-type ratios.

| | before | after |
|---|---|---|
| full refresh (4 strategies) | ~73 s | **18.5 s** |
| db-load-budget top query | 46.9% | **16.9%** — under threshold |

**Output verified identical, not assumed.** Old and new were run inside one
`REPEATABLE READ` transaction against a single snapshot and both returned
66,201 / 60,115 / 60,115 / 60,115. An earlier comparison had shown 12–16 row
differences and a `brrrr` divergence — that was crawl drift between sequential
runs, which the snapshot test ruled out. **Comparing two queries against a live
table is not a comparison.**

Cumulative effect on the stats aggregate across this session:

| stage | cost |
|---|---|
| original (is_rentable per row, 30 min cadence) | ~160 s/hour |
| after hoisting is_rentable + hourly | ~73 s/hour |
| **after one-scan-for-all-strategies** | **~18.5 s/hour** |

**~8.6× less database time than where the session started**, with byte-identical
output.
