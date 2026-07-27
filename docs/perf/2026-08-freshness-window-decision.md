# Freshness Window — Decision Record

**Date:** 2026-07-27 · **Plan:** `2026-08-10-sustainable-freshness-and-load.md` Task 1

## The problem

Two thresholds encode different definitions of "active", and nobody reconciled
them:

| setting | value | meaning |
|---|---|---|
| `STALE_AFTER_DAYS` (reaper, `apps/worker/src/lifecycle.ts`) | **10** | a listing stays **active** until unseen for 10 days |
| `FRESHNESS_WINDOW_DAYS` (probe, `ops/monitoring/inventory-freshness.sh`) | **7** | a listing is **unconfirmed** past 7 days |

Every listing between 7 and 10 days unseen is therefore *simultaneously* active
and unconfirmed — **by design, not by failure**. Measured:

| age of unconfirmed active listings | count |
|---|---|
| **7–8 days** | **78,684** |
| **8–10 days** | **66,589** |
| 10–14 days | 2,336 |
| 30 days+ / never | 3 |

**145,273 of 147,647 (98.4%) are in the disagreement band.** A perfectly
functioning system, crawling exactly to the reaper's tolerance, would still
report a failing SLO forever.

This is a defect in instrumentation I wrote. The probe was given a 7-day window
without checking it against the reaper it was implicitly auditing.

## The options

**(a) Probe measures 10 days, matching the reaper.**
The SLO becomes "is the reaper's promise being kept?" — a question the system is
built to answer. Immediately meaningful; the remaining failures are real.

**(b) Reaper tightens to 7 days.**
Makes the probe's number right by demoting ~145,273 listings to `stale` — hiding
them from every read surface. These are listings the *source still lists*. This
sacrifices fullness to make a metric look better, which is precisely backwards,
and it is forbidden by this plan's constraints.

**(c) Keep both windows, report the band separately.**
Most informative and most complex; two numbers to explain and two to maintain.

## Decision: (a), with the 7-day figure retained as a secondary, non-alerting number

The alerting SLO measures the 10-day window, because that is what the system
promises. The 7-day figure is still emitted on the probe's output line so the
tighter target stays visible and we can watch it improve as crawl throughput
rises — but it does not page anyone, because nothing is broken when it is below
100%.

**(b) is explicitly rejected.** Deleting 145,273 real listings from the product's
visible inventory to improve an internal metric would be trading the product for
the dashboard.

## What this does NOT fix

Reconciling the window makes the SLO *measurable*. It does not make the crawl
faster. Measured separately, and unaffected by this decision:

| quantity | value |
|---|---|
| confirmations needed for a 7-day sweep | 3,267 / hour |
| confirmations achieved | 1,898 / hour |
| | **58% of required** |

The 10-day window is achievable at 1,898/hour; the 7-day one is not. That gap is
a throughput problem, addressed by Task 4 of this plan and by
`2026-08-07-incremental-crawl.md`. **A reconciled window must never be reported
as though it were a throughput improvement.**

## Guard against recurrence

`FRESHNESS_WINDOW_DAYS` now defaults from the same value as `STALE_AFTER_DAYS`
rather than being an independent literal, so the two cannot silently drift apart
again.
