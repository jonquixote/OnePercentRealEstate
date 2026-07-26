# Crawl Throughput Audit

**Date:** 2026-07-26 · **Plan:** `docs/superpowers/plans/2026-08-02-make-active-mean-something.md` Task 1

## Baseline

Active for-sale inventory: **446,270**. Re-seen in the last 24 h: **73,905**.
New: **25,391**. Implied full sweep: **~6 days**, which matches the freshness
distribution exactly — the staleness is the sweep interval, not decay.

## Step 1: the limit is not a rate cap, and not scheduling gaps

Hourly re-seen counts over 24 h ranged **1,486 – 6,224**, with no zero hours:

```
07-25 10 | 1640      07-26 03 | 6224
07-25 14 | 1596      07-26 04 | 4194
07-25 22 | 1486      07-26 05 | 3521
```

Continuous but variable. A hard rate limit produces a flat ceiling; scheduling
gaps produce zero hours. Neither is present.

## Step 2: it is not ban-limited either — and my first measurement of that was wrong

A first pass counted "725 blocks" by grepping the scraper journal for
`ban|429|403|blocked`. **That was a false positive**: it was matching ZIP codes
containing those digits — `44035`, `40329`, and so on. The same class of mistake
as measuring photo coverage at a zoom level that returns clusters.

Parsing the scraper's own structured completion lines instead, over 24 h:

| Signal | Count |
|---|---|
| Scrapes completed | 8,135 |
| **Scrapes returning no results** | **14,562** |
| Rows inserted | 41,507 |
| Rows updated | 53,635 |
| Rows skipped | 26,285 |
| Real errors | **34** — all `geocoding.geo.census.gov` read timeouts |

Thirty-four errors in a day, none of them from the listing source. **The crawler
is not being blocked.** More nodes would not be multiplying a ban.

## Step 3: 64% of scrape work returns nothing

14,562 of 22,697 ZIP-level scrape operations returned no results — **64%**.

At the job level, `crawl_jobs` over 24 h:

| region_type | jobs | listings found | avg | zero-yield |
|---|---|---|---|---|
| `zip_recheck` | 160 | 1,812 | 11 | **63 (39%)** |

Per-ZIP job duration ranged **14 s – 378 s**. One region type is running; there
is no diversity of crawl strategy.

**The important part:** all 160 jobs targeted ZIPs that have active inventory
*according to our database*, and 63 of them found nothing at all.

```
 zero-yield jobs where the ZIP is empty in our DB : 0
 zero-yield jobs where the ZIP HAS inventory      : 63
```

That is not a scheduling bug. It is the freshness problem measured from the
other side: **we are re-checking ZIPs where we believe listings are active, and
the source says they are not there.** Those listings are sold, withdrawn, or
expired, and the product is still showing them.

## Step 4: capacity

```
SCRAPER_URLS=http://127.0.0.1:8001
```

One node, local. Provisioned nodes from earlier sessions are recorded as idle
pending the stateless-nodes work (PR #85). The ceiling is therefore
**per-ZIP scrape latency × one node**, with roughly two thirds of that latency
spent on ZIPs that yield nothing.

## Recommendation

**Do Task 3 first, not Task 2.**

The plan assumed the sequence was "crawl faster, then be honest about what
remains". The measurement inverts the priority:

1. **The staleness is not primarily a capacity shortfall.** The crawler is
   healthy, unblocked, and working continuously. Adding nodes would raise
   throughput, but 64% of the additional work would also return nothing, so the
   effective gain is roughly a third of the nominal one.
2. **The zero-yield rechecks are positive evidence that "active" overstates
   reality.** We are not guessing that some active listings are gone — the
   source is telling us, 63 ZIPs a day at a time. Shipping honest freshness
   (Task 3) converts that evidence into something a user can act on
   *immediately*, and it is true regardless of how fast the crawl ever gets.
3. **Task 2 remains worth doing**, but as a throughput improvement with a known
   ~3× discount, not as the fix for trust. It should be sequenced behind the
   stateless-nodes work rather than pulled forward, because bringing nodes up by
   hand risks the `SCRAPER_URLS` outage that cost ten hours of dead crawl.

A cheaper throughput win exists and should be measured before any new hardware:
**deprioritise ZIPs that repeatedly yield nothing.** If a ZIP has returned no
results on its last N rechecks, it does not need the same cadence as a dense
market. That reclaims a large share of the 64% without adding a node — but it
must not become "never re-check", or new inventory in a quiet ZIP is invisible
forever.
