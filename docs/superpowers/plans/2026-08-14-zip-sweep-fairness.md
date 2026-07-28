# ZIP Sweep Fairness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop starving a fifth of the country. 5,345 active ZIPs went uncrawled for a full week while others were crawled 9–12 times — no amount of throughput fixes freshness while that is true.

**Architecture:** Find out why the scheduler is uneven, make ZIP selection fair by construction (least-recently-swept first, with a hard starvation ceiling), and prove no market is left behind — without reducing coverage of dense markets, which produce most of the inventory.

**Tech Stack:** PostgreSQL 16, `apps/worker` crawl orchestration (`RECHECK_ENQUEUE_SQL` in `lifecycle.ts`), bash ops probes.

## The measured problem

Prod, 2026-07-28:

| Fact | Value |
|---|---|
| Active for-sale ZIPs | 24,676 |
| **Active ZIPs NOT crawled in 7 days** | **5,345 (21.7%)** |
| ZIPs crawled 9–12 times in the same 7 days | dozens |
| ZIP sweep interval (aggregate) | ~5.5 days |
| 7-day freshness | **70.5%**, stuck |
| 10-day freshness (SLO) | 99.9% |

**A fifth of active inventory cannot be confirmed at all**, because its ZIPs are
never visited. Those listings age past 7 days by construction, which is exactly
why the 7-day figure sits near 70% no matter what throughput does.

This is the missing piece. Earlier work established:

- Freshness is governed by **ZIP sweep interval**, not confirmations/hour
  (`docs/perf/2026-08-zip-sweep-is-the-metric.md`).
- Confirmations rose 57% over one period while 7-day freshness *fell*.
- The aggregate sweep of ~5.5 days should comfortably beat a 7-day target — and
  does not, because the sweep is not uniform.

**An aggregate interval hides starvation.** 24,676 ZIPs at ~1,118 per 6 hours
*averages* to 5.5 days, but averages say nothing about the tail when the
selection is uneven.

## Global Constraints

- **No market may be starved.** Every active ZIP must be visited within a bounded interval, regardless of how little it yields. A quiet ZIP with one new listing next month is exactly the deal-rich, low-volume market the product exists to surface — deal rate is **37.5%** in the lowest-volume decile against 7.1% in the highest.
- **Do not reduce coverage of dense markets to achieve fairness.** They produce most of the inventory. Fairness must come from the ordering, not from a cap on the productive ZIPs.
- **Never treat "no results" as "ZIP is empty".** A zero-yield recheck is a statement about our data, not the ZIP.
- **Every measurement must be density-normalised or same-ZIP.** Job duration tracks ZIP density (p50 6.9 s at 0 rows vs 144.8 s at 200+); two conclusions were already lost to this confound.
- **The crawl shares Postgres with both apps.** Watch `db-load-budget.sh` and `crawl-health.sh`.
- Latency budgets in `docs/perf/perf-budgets.md` bind.

---

## Task 1: Find out why the scheduler is uneven

**Files:**
- Read: `apps/worker/src/lifecycle.ts` (`RECHECK_ENQUEUE_SQL`), the claim path in `apps/worker/src/crawl.ts`
- Create: `docs/perf/2026-08-sweep-fairness-audit.md`

**Interfaces:**
- Produces: the mechanism behind the 5,345 starved ZIPs, which decides Task 2.

- [ ] **Step 1: Read the enqueue rule and state its ordering in one sentence.**

```bash
grep -n -A20 "RECHECK_ENQUEUE_SQL" apps/worker/src/lifecycle.ts
```

**Do not proceed until you can say exactly which ZIPs it picks and in what
order.** The 21.7% starvation is a *consequence* of that rule; guessing at the
fix without reading it is how the last three crawl changes went wrong.

- [ ] **Step 2: Characterise the starved set.** Are they random, or do they share
      a property?

```sql
WITH starved AS (
  SELECT DISTINCT zip_code FROM listings
   WHERE listing_status='active' AND listing_type='for_sale' AND zip_code ~ '^\d{5}$'
  EXCEPT
  SELECT DISTINCT region_value FROM crawl_jobs WHERE finished_at > now()-interval '7 days'
)
SELECT count(*) AS starved_zips,
       round(avg(n)) AS avg_listings_per_starved_zip,
       min(n) AS min_listings, max(n) AS max_listings
  FROM (SELECT s.zip_code, count(*) AS n
          FROM starved s JOIN listings l ON l.zip_code = s.zip_code
         WHERE l.listing_status='active' AND l.listing_type='for_sale'
         GROUP BY 1) t;
```

**If the starved ZIPs are systematically low-volume, this is worse than it
looks** — deal rate is 5.3× higher in the lowest-volume decile, so the scheduler
would be starving precisely the deal-richest markets.

- [ ] **Step 3: Check whether the queue is the constraint or the selection is.**
      Are starved ZIPs never *enqueued*, or enqueued and never *claimed*?

```sql
SELECT status, count(*) FROM crawl_jobs
 WHERE created_at > now()-interval '7 days' GROUP BY 1;
SELECT count(*) FROM crawl_jobs WHERE status='pending';
```

A permanently non-empty `pending` queue means the enqueue rate exceeds the drain
rate and old entries never surface — a different bug from never being enqueued.

- [ ] **Step 4: Write the audit** naming the mechanism and recommending one fix.
      Commit — `docs(crawl): sweep fairness audit — why a fifth of ZIPs are starved`

---

## Task 2: Make selection fair by construction

**Files:**
- Modify: `apps/worker/src/lifecycle.ts` (`RECHECK_ENQUEUE_SQL`)
- Modify: `apps/worker/src/lifecycle.test.ts`
- Create: `infrastructure/migrations/2026_08_14_zip_sweep_state.sql` (only if Task 1 shows we cannot derive last-swept from `crawl_jobs`)

**Interfaces:**
- Consumes: Task 1's mechanism.
- Produces: an enqueue rule where the longest-unswept active ZIP is always eligible.

- [ ] **Step 1: Write the failing tests.** These pin the property that matters —
      fairness is a *guarantee*, not a tendency:

```ts
describe('RECHECK_ENQUEUE_SQL', () => {
  it('orders by least-recently-swept, so the oldest ZIP is always next', () => {
    expect(RECHECK_ENQUEUE_SQL).toMatch(/ORDER BY[\s\S]*last_swept|last_crawled|finished_at/i);
  });

  it('includes ZIPs that have NEVER been swept', () => {
    // A NULL last-swept must sort first, not be excluded by a join or a
    // comparison against NULL. 5,345 ZIPs were invisible to the old rule.
    expect(RECHECK_ENQUEUE_SQL).toMatch(/NULLS FIRST|IS NULL|LEFT JOIN/i);
  });

  it('does not filter ZIPs by yield — a quiet market is not a dead one', () => {
    expect(RECHECK_ENQUEUE_SQL).not.toMatch(/listings_found\s*>\s*0|rows_confirmed\s*>\s*0/i);
  });

  it('stays bounded — the enqueue is a capped page, not the whole table', () => {
    expect(RECHECK_ENQUEUE_SQL).toMatch(/LIMIT \$\d/);
  });
});
```

- [ ] **Step 2: Run them, watch them fail**, then implement least-recently-swept
      ordering with `NULLS FIRST`. Derive last-swept from `crawl_jobs` if Task 1
      showed that is reliable; otherwise add the state table.

- [ ] **Step 3: Verify the ordering is index-backed**, not a sort of 24k ZIPs
      joined against an 11 GB table, per `EXPLAIN (ANALYZE, BUFFERS)`. Record the
      plan.

- [ ] **Step 4: Deploy and measure starvation daily for a week.** The single
      number that matters:

```sql
SELECT count(*) FROM (
  SELECT DISTINCT zip_code FROM listings
   WHERE listing_status='active' AND listing_type='for_sale' AND zip_code ~ '^\d{5}$'
  EXCEPT
  SELECT DISTINCT region_value FROM crawl_jobs WHERE finished_at > now()-interval '7 days'
) x;
```

Expected trajectory: **5,345 → 0** over roughly one sweep interval. If it
plateaus above zero, the remaining ZIPs share a property Task 1 missed — find it
rather than accepting the number.

- [ ] **Step 5: Confirm dense markets did not lose coverage.** Fairness must come
      from ordering, not from throttling productive ZIPs:

```sql
SELECT count(DISTINCT region_value) AS zips, sum(rows_confirmed) AS conf
  FROM crawl_jobs WHERE finished_at > now()-interval '24 hours';
```

Compare against the pre-change day. **ZIP count should rise; confirmations should
not fall materially.** If confirmations drop sharply, dense ZIPs are being
crowded out and the fix has traded one starvation for another.

- [ ] **Step 6: Commit** — `fix(crawl): least-recently-swept ordering — no ZIP starves`

---

## Task 3: A starvation probe, so this cannot return

**Files:**
- Create: `ops/monitoring/sweep-starvation.sh`
- Create: `ops/systemd/oper-sweep-starvation.{service,timer}`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Write the probe** around the Task 2 Step 4 query, alerting when
      any active ZIP has gone unswept longer than the SLO window. Follow
      `ops/monitoring/photo-coverage.sh` for `--key` / `--resolved` structure.

**It must be index-backed** — `listings` is 11 GB and this probe runs on a timer.
`EXPLAIN` it and record the plan, per the rule that a probe must cost less than
what it protects (a previous one seq-scanned for 9.65 s twice an hour).

- [ ] **Step 2: Report the worst offender**, not just a count: the ZIP and how
      many days it has waited. A count alone gives nobody a place to start.

- [ ] **Step 3: Prove it fires and resolves** by the established method — set the
      threshold so it must fire, confirm the message and the state file, restore,
      confirm RESOLVED clears it.

- [ ] **Step 4: Update `docs/HANDOFF.md` §7** and commit —
      `feat(crawl): starvation probe — no market silently disappears`

---

## Self-Review

**Spec coverage:** the 21.7% starvation is diagnosed (T1), fixed at the selection
rule with fairness as a tested guarantee rather than a tendency (T2), and
guarded so it cannot silently return (T3). T2 Step 5 exists because the obvious
fix — round-robin everything — could starve dense markets instead, trading one
failure for its mirror image.

**Placeholder scan:** every task names files, exact SQL, and what to record. The
one deliberately open decision — whether last-swept can be derived from
`crawl_jobs` or needs its own table — is produced by T1 and explicitly gates T2.

**Type consistency:** no new runtime contracts. `RECHECK_ENQUEUE_SQL` keeps its
signature (one bound param, the batch size); only its ordering changes, so the
call site in `runLifecycleTick` is untouched.
