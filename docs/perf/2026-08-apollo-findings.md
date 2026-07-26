# Apollo — Findings

**Date:** 2026-07-26 · **Plan:** `docs/superpowers/plans/2026-08-06-apollo-probe-homeharvest.md`
**Mission status:** completed, **never blocked**. ~19 library calls, ~60 estimated HTTP requests, serial, 20–120 s cooldowns.

---

## Finding 1 — production sees 16% of available inventory

The single most consequential result of the mission. Same ZIP, same listing
type, one parameter different:

| query | rows |
|---|---|
| `scrape_property("33020", "for_sale")` | **567** |
| `scrape_property("33020", "for_sale", past_days=30)` — **what production sends** | **89** |

Across the Rung 1 baseline, the probe consistently returned far more than our
database holds for the same ZIP:

| ZIP | probe (no `past_days`) | our DB | ratio |
|---|---|---|---|
| 33020 | 567 | 38 | **14.9×** |
| 74020 | 75 | 13 | 5.8× |
| 37060 | 46 | 7 | 6.6× |

`past_days=30` filters by **list date**, not by activity. So the crawler only
ever ingests properties *listed* in the last 30 days. Everything listed 31+ days
ago and still for sale is structurally invisible to us.

### Why this is worse than a coverage number

Days-on-market is one of the strongest deal signals there is. Long DOM is where
price cuts, motivated sellers, and stale pricing live — and the product already
computes `price_cut_pct` and `days_on_market` as deal inputs. **The current
crawl is blind to exactly the inventory most likely to contain deals**, and
blind by construction rather than by accident.

It also explains the 64% empty-scrape rate directly: a ZIP with no *newly
listed* property in 30 days returns nothing, even when it holds hundreds of
active listings.

---

## Finding 2 — a broader query can silently miss listings

The containment test, run because counts alone cannot answer it: two result sets
of similar size can be different sets.

**Small county — clean containment.** Neither query truncated:

| | Pawnee County, OK |
|---|---|
| ZIP 74020 unique | 75 |
| county unique | 188 |
| in both | 75 |
| **in ZIP not in county** | **0** |

**Larger county — containment fails.** The county query returned 5,354 rows,
**under** the 10,000 cap, so this is not a truncation artifact:

| | Cuyahoga County, OH |
|---|---|
| county unique | 5,217 |
| ZIP 44120 unique | 245 |
| in both | 244 |
| **in ZIP not in county** | **1** |

The missing listing:

```
property_id 4922521823 · 13405 Svec Ave, Cleveland OH 44120
county: Cuyahoga · status: CONTINGENT · list_price: $115,000
```

It is genuinely in Cuyahoga — **not** a ZIP-straddles-county boundary artifact.
A county-shaped query omitted a real, in-county, in-cap listing that the ZIP
query found.

And it is a $115,000 Cleveland property: the exact cheap-market profile where
the 1% line clears. A small fish from afar that is a whale up close.

**Conclusion: a county-shaped crawl cannot replace ZIP sweeps. It can supplement
them, but it must be backstopped, or we lose deals we can never know we lost.**

---

## Finding 3 — the real cost unit, and truncation behaviour

`homeharvest` pages the underlying GraphQL query at **`limit: 200`**
(`core/scrapers/realtor/__init__.py:425`). One `scrape_property()` call costs
**ceil(rows / 200)** HTTP requests.

| shape | probe | rows | wall | est. HTTP |
|---|---|---|---|---|
| zip | 37060 | 46 | 1.0 s | 1 |
| zip | 74020 | 75 | 1.2 s | 1 |
| zip | 33020 | 567 | 7.4 s | 3 |
| city | Hollywood, FL | 1,000 (capped) | 11.9 s | 5 |
| county | Broward County, FL | 1,000 (capped) | 12.5 s | 5 |
| county | Cuyahoga County, OH | **5,354** | 72.2 s | 27 |

Requesting `limit=N` returns exactly N when more exist — truncation is silent,
and **what falls off is decided by the API's sort order, not by relevance**. Any
broader-shape crawl must either stay under the cap or paginate deliberately.

Throughput per request is roughly comparable across shapes (~200 rows/request by
construction), so the advantage of a broader shape is **not** rows-per-request —
it is *ZIP discovery* and *fewer scheduling decisions*.

---

## Finding 4 — the parameter surface production ignores

| parameter | default | production sends | opportunity |
|---|---|---|---|
| `past_days` | None | **30** | **remove it — Finding 1** |
| `updated_in_past_hours` / `updated_since` | None | — | incremental recheck instead of full re-scrape |
| `price_max` | None | — | target the band where the 1% line clears |
| `property_type` | None | — | skip `land`/`farm`, already `not_applicable` for rent |
| `limit` / `offset` | 10000 / 0 | — | deliberate pagination past the cap |
| `exclude_pending` | False | — | |

`updated_in_past_hours` is the structural answer to the 64% empty-scrape
problem — *if* it works at region scale. **Untested; it is the first thing the
next mission should probe.**

---

## Verdict — recommended crawl architecture

**1. Drop `past_days=30` from the for-sale crawl. This is the highest-value
change available anywhere in the system right now.** It is a one-line change
that multiplies visible inventory ~6× and specifically unblinds the long-DOM
segment where deals concentrate. It must be rolled out deliberately — ingest
volume will rise sharply and the rent estimator queue, the dedupe path, and disk
all need watching.

**2. Keep ZIP as the crawl unit. Do not adopt county-shaped crawling as a
replacement.** Containment fails at scale (Finding 2), truncation is silent
(Finding 3), and rows-per-request is not actually better.

**3. Use county queries for ZIP discovery only.** A county query enumerates ZIPs
we have never seen — Cuyahoga returned 49 distinct ZIPs, Broward 53 — which is
the one thing ZIP-shaped scheduling structurally cannot do, since its queue is
built from ZIPs we already know. That closes the ~5,500-ZIP coverage gap without
trusting county queries for completeness.

**4. Probe `updated_in_past_hours` next**, before building any scheduler. If it
works at ZIP scale it changes the recheck economics entirely, and any scheduler
built first would have to be rebuilt.

## What must change in the already-written plans

- **`2026-08-04-crawl-yield-scheduling.md` — rewrite before executing.** Its
  metric (listing yield) is wrong: deal rate falls monotonically with listing
  volume, 37.5% in the lowest decile against 7.1% in the highest. Scheduling by
  yield would steer the crawler toward the deal-poorest markets. It also predates
  Findings 1 and 4, either of which changes the economics it assumes.
- **`2026-08-02-make-active-mean-something.md` — Task 2 assumptions are stale.**
  It treats throughput as capacity-bound. Finding 1 says the binding constraint
  is a parameter, not a node count.
- **`2026-08-05-indexability-and-honest-urls.md` — unaffected.** Its measurements
  stand independently.
