# Hot/Cold Listings — Decision Record

**Date:** 2026-07-27 · **Plan:** `docs/superpowers/plans/2026-07-27-hot-cold-listings.md` Task 1

## The problem, measured

| Status | Rows | Share |
|---|---|---|
| `stale` | 727,528 | **59%** |
| `active` | 492,459 | 40% |
| `sold` | 65,949 | 5% |
| `pending_verify` | 25,125 | 2% |
| `rental_misfiled` | 2,877 | <1% |

`listings`: **9,625 MB table + 1,286 MB indexes**. Every user-facing query filters
the cold statuses out; every sequential scan still reads them.

## DECISION: (B) partial indexes + archival. **(A) partitioning is ruled out.**

### Why (A) `PARTITION BY LIST (listing_status)` cannot be used

A LIST-partitioned table requires the partition key to appear in **every** unique
constraint and the primary key. `listings` has:

```
listings_pkey                    PRIMARY KEY (id)
listings_addr_type_saletype_uniq UNIQUE (address, listing_type, sale_type)
```

Adding `listing_status` to the PK is harmless. Adding it to
`listings_addr_type_saletype_uniq` is **not**: that constraint exists to enforce
*one row per (address, listing_type, sale_type)*, and it is the conflict target
the scraper's upsert relies on (`ON CONFLICT (address, listing_type, sale_type)`).

Including the status in it would permit the **same address to exist twice** — once
`active`, once `stale` — which is precisely the duplication the constraint
prevents, and it would silently break the crawler's idempotent upsert into an
insert-a-new-row-per-status-change bug.

**No amount of partitioning benefit justifies weakening the table's core
integrity constraint.** Option (A) is closed.

### What (B) looks like, and what is deferred

Two separable pieces with very different risk:

1. **Partial / covering indexes on the lifecycle predicate — LOW RISK, do now.**
   No data moves. Hot queries get indexes that only contain the ~40% of rows
   anyone reads. The pattern is already proven here: matching the partial
   `idx_listings_last_seen` predicate took a probe from **8,435 ms → 0.134 ms**.

2. **Physically moving `stale` rows to `listings_archive` — DEFERRED, gated.**
   This is where the 59% size win lives, but it is genuinely risky:
   - `/property/[id]` must still render a stale listing (old links, shared URLs,
     search-engine traffic). Moving rows without a read-through fallback turns
     every stale listing's page into a 404 — a large SEO regression on a site
     that just published a 33k-URL sitemap.
   - Sold comps and `/sold/[id]` read cold rows deliberately.
   - The crawler's upsert must still resurrect an archived listing that comes
     back on the market, or the unique constraint above will be violated on
     re-insert.
   Requires: read-through fallback in the property loader, an archive-aware
   upsert path, and a rehearsal on a restored snapshot. Not a same-session change.

## Context that changed the calculus

Most of the *user-facing* pain this plan was written to solve has since been
fixed at the source, without touching table structure:

| Surface | Before | After | How |
|---|---|---|---|
| `/api/stats` | 18.5 s | 0.012 s | precomputed `stats_summary` + SWR |
| `/api/stats/median-rent` | 7.1 s | 0.009 s | folded into the same pass |
| `/market/<zip>` | 10.4 s | see below | cached nationwide ZIP ranking |
| exporter scan | 79% of all DB time | 0.020 ms | counter table |
| crawl-freshness probe | 8,435 ms | 0.134 ms | matched the partial index |

The remaining full-table scans are all **bounded background passes** now (stats
refresh 4×~30 s / 30 min, two MV refreshes / 30 min), not request-path work.

So the archival step's value is now "make the background passes and indexes
smaller", not "make the product usable". That is a real win, but it no longer
justifies rushing the riskiest change in the codebase. It stays specced and
gated.

## Next action

Proceed with piece 1 (indexes) and measure. Re-evaluate piece 2 when either:
- background passes become a load-budget problem again, or
- table growth pushes the box toward its disk/memory limits.
