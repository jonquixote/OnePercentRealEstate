# Crawl Capacity — the plan that should go AFTER Apollo III

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the freshness gap — 1,898 confirmations/hour against the 3,267 a 7-day sweep needs — using whatever Apollo III proves is safe.

**Why after Apollo III:** this plan's central parameter is the safe concurrency
level, and that number does not exist yet. Writing it now would repeat the
mistake of `2026-08-04-crawl-yield-scheduling.md`, which was written on an
assumption and superseded before a line of it ran.

**This plan is deliberately a sketch.** Its tasks cannot be specified honestly
until Apollo III returns, and pretending otherwise would be the placeholder
writing this repo's planning standard forbids.

## Shape, conditional on Apollo III's findings

- **If concurrency is safe at level N:** raise `parallel`/worker concurrency one
  step at a time, measuring confirmations/hour against the Task-1 meter after
  each step, and stopping at the first structured block signal. Expected to be
  the cheapest path — the capacity already exists.
- **If concurrency is *not* safe:** the answer is more egress, i.e. the idle
  scraper nodes and the stateless-nodes work (PR #85). Note that Apollo III
  Task 1 Step 5 explicitly tests whether limits are per-IP or account-level — if
  account-level, **more nodes will not help** and this branch is void.
- **If a county-shaped sweep confirms materially faster** (Apollo III Task 2),
  restructure confirmation around it, backstopped by ZIP sweeps for the ~1%
  marginal loss and the ~1-in-5 misresolution rate, per
  `2026-08-07-incremental-crawl.md` Task 1b.
- **`past_days` unlimited** is decided by Apollo III Task 3's
  requests-per-confirmed-listing figure, not by the inventory gain alone.

## Hard constraints carried forward

- **No stream may be starved.** `for_sale` 9,419 new rows/day,
  `rental_listings` 8,276, `sold_listings` 7,536 — all comparably productive.
  This is what refused Task 4 of the freshness plan and it still holds.
- **No threshold widened to make a number look better.**
- Every step measured against the confirmations/hour meter, before and after.
