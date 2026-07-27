# Crawl Observability — the plan that should go BEFORE Apollo III

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Be able to answer "did that change help?" about the crawl in minutes rather than by hand-querying, before spending Apollo III's request budget or changing crawl concurrency.

**Why before Apollo III:** every crawl measurement this session was reconstructed
by hand from `pg_stat_statements`, journal greps and ad-hoc SQL — and two of
those reconstructions were **wrong** (a "725 blocks" reading that was ZIP codes
containing `403`, and a photo-coverage figure taken at a zoom level that returns
clusters). Apollo III will produce numbers that justify changing production
concurrency. Those numbers deserve better instrumentation than the ones that
have already misled us twice.

It is also cheap, carries no source risk, and makes Apollo III's results
verifiable against production rather than standing alone.

## Tasks

1. **A crawl-throughput table.** Record per crawl job: shape, params, requests
   issued, rows returned, rows *confirmed* (`last_seen_at` actually advanced),
   wall time. Confirmations are the unit the freshness SLO is denominated in and
   nothing records them today.
2. **Confirmations/hour as a first-class metric**, on the same footing as the
   coverage probes, with the 3,267/hour requirement drawn as the line.
3. **Block detection from structured fields**, never log greps — the false "725
   blocks" reading came from `grep 403` matching ZIP codes.
4. **A per-stream coverage panel** — `listings`, `rental_listings`,
   `sold_listings` — so any future rebalancing proposal can be checked against
   what it costs the other streams. This is exactly the check that refused Task 4
   of the freshness plan.

## Why it must come first

Apollo III Task 1 changes concurrency against a live source. If it works we will
want to apply it to production immediately — and the only way to know whether it
helped is a confirmations/hour number that exists *before* the change, measured
the same way after. Building the meter after the experiment means comparing
against a baseline reconstructed by hand, which is how the two bad measurements
above happened.
