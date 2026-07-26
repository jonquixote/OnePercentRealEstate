# Apollo II Task 1 — Fidelity of `updated_in_past_hours`

**Date:** 2026-07-26 (t0 captured) · **Plan:** `2026-08-09-apollo-ii-ceiling-and-fidelity.md`
**Status:** Steps 1, 4, 5 complete. Steps 2–3 pending the 24-hour re-snapshot.

## Step 1 — same-instant baseline (Cuyahoga County, OH)

| query | rows | wall |
|---|---|---|
| full | 5,351 | 69.9 s |
| `updated_in_past_hours=24` | 189 | 2.8 s |

**The incremental set is a strict subset of the full set** — 0 rows outside it.
So the filter never invents rows the full query does not know about.

Status distribution, incremental against the whole county:

| status | county | in inc24 | share |
|---|---|---|---|
| `FOR_SALE` | 3,232 | 141 | 4.4% |
| `PENDING` | 1,473 | 33 | 2.2% |
| `CONTINGENT` | 646 | 15 | 2.3% |

The incremental set spans every status rather than clustering in one, which is
the first evidence that it is not a "newly listed only" filter in disguise.

## Step 4 — the window is monotonic and behaves as named

| `updated_in_past_hours` | rows | wall |
|---|---|---|
| 1 | 8 | 2.0 s |
| 6 | 17 | 1.6 s |
| 12 | 29 | 2.0 s |
| 24 | 189 | 2.5 s |
| 48 | 526 | 8.3 s |
| 72 | 868 | 11.4 s |
| 168 | 1,670 | 21.8 s |

Strictly increasing, no plateau, no truncation. A wider window returns a proper
superset, so **a sweep can safely overlap its own gap** — which the incremental
crawl design depends on (a window exactly equal to the gap would drop anything
that changed while the previous sweep was running).

Useful rate: **1,670 of 5,351 (31%) of a county changes in a week.** So a weekly
full sweep and a daily incremental sweep are roughly the same order of work, and
the daily one is far fresher.

## Step 5 — disappearance is structurally unobservable

A listing that leaves the market simply stops appearing. No query returns "this
one is gone". The reaper infers it from `last_seen_at`, and **an incremental
sweep never re-sees the unchanged**, so it can never confirm continued
existence.

**Consequence, stated plainly: incremental sweeps cannot drive the lifecycle.**
They detect change; only a full sweep confirms presence. This is why
`2026-08-07-incremental-crawl.md` Task 3 keeps the ZIP backstop, and that task is
now load-bearing rather than precautionary.

## Steps 2–3 — pending

`results/t0_full.json` and `results/t0_inc24.json` are captured. Re-run
`fidelity.py t1` after 24 h and diff to score recall per change class — price
decreased, price increased, status transitions, newly listed. **Recall below
100% on "price decreased" or "newly listed" is disqualifying for a pure
incremental architecture.**
