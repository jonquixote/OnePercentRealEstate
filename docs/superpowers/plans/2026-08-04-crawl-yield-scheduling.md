# Crawl Yield Scheduling Implementation Plan

> ## ⛔ SUPERSEDED — DO NOT EXECUTE
>
> Superseded by `2026-08-07-incremental-crawl.md`. Retained for the reasoning,
> not the instructions. Two independent measurements invalidated it:
>
> **1. Its metric is backwards.** It schedules by listing yield. Deal rate falls
> monotonically as listing volume rises — **37.5%** in the lowest-volume decile
> against **7.1%** in the highest, a 5.3× spread. Scheduling by yield would steer
> the crawler toward the deal-poorest markets, which is the opposite of the
> product's purpose.
>
> **2. Its premise dissolved.** The plan exists because 64% of ZIP scrapes return
> nothing. Apollo found the cause: production sends `past_days=30`, so a ZIP with
> no *newly listed* property in 30 days returns nothing even when it holds
> hundreds of active listings — and we see only **16%** of available inventory as
> a result. It also found that a county's entire daily change set costs **2 HTTP
> requests and 3.7 s** via `updated_in_past_hours`, against 27 requests to refetch
> that county. When a county's changes cost two requests, "which ZIP next"
> largely stops being a question worth optimising.
>
> Evidence: `docs/perf/2026-08-apollo-findings.md`.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop spending two thirds of the crawl budget on ZIPs that return nothing, so inventory freshness improves without adding a single scraper node.

**Architecture:** The crawler currently rechecks ZIPs on a flat rotation. Record what each ZIP actually yields, then schedule by expected yield instead of by position in a queue — while guaranteeing every ZIP is still visited on a bounded interval, so a quiet market can never become invisible.

**Tech Stack:** PostgreSQL 16, `services/scraper_service` (FastAPI + homeharvest), `apps/worker` crawl orchestration, bash ops probes.

## The measured problem

Prod, 24 hours to 2026-07-26 (`docs/perf/2026-08-crawl-throughput-audit.md`):

| Signal | Count |
|---|---|
| Scrapes completed | 8,135 |
| **Scrapes returning no results** | **14,562 (64%)** |
| Rows inserted | 41,507 |
| Rows updated | 53,635 |
| Real errors | 34 (all census geocoding timeouts) |

At the job level, `crawl_jobs`, one region type only:

| region_type | jobs | found | avg | zero-yield |
|---|---|---|---|---|
| `zip_recheck` | 160 | 1,812 | 11 | **63 (39%)** |

Per-ZIP job duration: **14 s – 378 s**.

**The crawler is healthy.** It is not banned, not rate-limited, and never idle —
34 errors in a day, none from the listing source. It is simply spending most of
its time on ZIPs that have nothing to give.

Consequence, measured directly: only **76.3%** of active inventory has been
confirmed within seven days, and **105,672 listings** the product shows as
active have not been confirmed at all in that window.

## Why this is the right lever

The obvious response to a slow sweep is more scraper nodes, and capacity is
sitting idle. But the audit found that ~64% of any additional work would also
return nothing — so a second node buys roughly a third of its nominal
throughput. Fixing the yield ratio first makes every node, present and future,
about three times more productive.

There is also a trap to avoid. The naive fix — "stop crawling ZIPs that return
nothing" — silently breaks the product: a quiet ZIP with one new listing next
month never gets seen, and the gap is invisible because the thing missing was
never in the database to be counted. **Deprioritise, never abandon.**

## Global Constraints

- **Every ZIP must be visited within a bounded interval, regardless of yield history.** The schedule may reorder work; it may not permanently exclude any market.
- **Never treat "no results" as "ZIP is empty".** A zero-yield recheck on a ZIP where our database says listings are active is evidence those listings are *gone* — a signal about our data, not about the ZIP. All 63 zero-yield jobs measured were of exactly this kind.
- **Respect the source.** The crawler is currently unblocked; any change that raises request rate must watch for the block signals appearing, and must not parse ZIP codes as HTTP status codes (a first pass at this counted 725 "blocks" that were ZIPs containing `403`/`429`).
- **Bounded scheduling queries.** `listings` is 11 GB; the scheduler must not full-scan it to pick the next ZIP.
- **No user-facing regression.** `docs/perf/perf-budgets.md` binds; watch `db-load-budget.sh` and `crawl-health.sh` throughout.

---

## Task 1: Record what each ZIP actually yields

**Files:**
- Create: `infrastructure/migrations/2026_08_04_zip_crawl_stats.sql`
- Modify: wherever `crawl_jobs` rows are completed (find with `grep -rn "listings_found" apps/worker services/`)

**Interfaces:**
- Produces: `zip_crawl_stats(zip_code, last_crawled_at, last_yield, consecutive_zero, ewma_yield, updated_at)`

- [ ] **Step 1: Write the migration.** One row per ZIP, updated on every completed job — not an append-only log, which would grow unbounded:

```sql
-- Per-ZIP crawl yield, so the scheduler can spend its budget where listings
-- actually are. 64% of scrapes returned nothing on 2026-07-26 while the crawler
-- was healthy and unblocked; this is the state needed to fix that.
CREATE TABLE IF NOT EXISTS zip_crawl_stats (
  zip_code          text PRIMARY KEY,
  last_crawled_at   timestamptz,
  last_yield        integer NOT NULL DEFAULT 0,
  consecutive_zero  integer NOT NULL DEFAULT 0,
  -- Exponentially weighted mean, so a ZIP that wakes up is promoted quickly
  -- rather than being held down by months of history.
  ewma_yield        double precision NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The scheduler's only read: "least recently crawled among the promising".
CREATE INDEX IF NOT EXISTS idx_zip_crawl_stats_due
  ON zip_crawl_stats (last_crawled_at NULLS FIRST);
```

- [ ] **Step 2: Write the failing test** for the update rule, as a pure function so it is testable without a database:

```ts
import { describe, it, expect } from 'vitest';
import { nextStats } from './zip-yield';

describe('nextStats', () => {
  it('resets the zero streak when a crawl yields something', () => {
    const s = nextStats({ ewma_yield: 2, consecutive_zero: 5 }, 10);
    expect(s.consecutive_zero).toBe(0);
    expect(s.ewma_yield).toBeGreaterThan(2);
  });

  it('increments the zero streak when a crawl yields nothing', () => {
    expect(nextStats({ ewma_yield: 4, consecutive_zero: 2 }, 0).consecutive_zero).toBe(3);
  });

  it('decays the mean toward zero on repeated empties without pinning it there', () => {
    let s = { ewma_yield: 8, consecutive_zero: 0 };
    for (let i = 0; i < 5; i++) s = nextStats(s, 0);
    expect(s.ewma_yield).toBeLessThan(8);
    expect(s.ewma_yield).toBeGreaterThan(0);
  });

  it('recovers quickly when a quiet ZIP produces listings again', () => {
    let s = { ewma_yield: 0.1, consecutive_zero: 20 };
    s = nextStats(s, 40);
    expect(s.consecutive_zero).toBe(0);
    expect(s.ewma_yield).toBeGreaterThan(5);
  });

  it('never returns a negative or non-finite mean', () => {
    for (const y of [0, 1, 1000]) {
      const s = nextStats({ ewma_yield: 0, consecutive_zero: 0 }, y);
      expect(Number.isFinite(s.ewma_yield)).toBe(true);
      expect(s.ewma_yield).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 3: Run it, watch it fail, then implement** `nextStats` with an EWMA alpha around 0.3 — high enough that a ZIP waking up is promoted within a few crawls.

- [ ] **Step 4: Write the stats on job completion**, in the same transaction that marks the job complete, so a crashed worker cannot leave the two disagreeing.

- [ ] **Step 5: Backfill from history** so the scheduler is not cold on day one:

```sql
INSERT INTO zip_crawl_stats (zip_code, last_crawled_at, last_yield, ewma_yield)
SELECT region_value, max(finished_at), 0, avg(listings_found)
  FROM crawl_jobs
 WHERE region_type = 'zip_recheck' AND finished_at IS NOT NULL
 GROUP BY region_value
ON CONFLICT (zip_code) DO NOTHING;
```

- [ ] **Step 6: Commit** — `feat(crawl): record per-ZIP yield history`

---

## Task 2: Schedule by expected yield, with a floor

**Files:**
- Modify: the crawl scheduler in `apps/worker`
- Test: alongside it

**Interfaces:**
- Consumes: `zip_crawl_stats` from Task 1.

- [ ] **Step 1: Write the failing test for selection**, pinning the two properties that matter — productive ZIPs come first, and *nothing is starved*:

```ts
it('prefers ZIPs with a higher expected yield', () => { /* … */ });

it('always includes a ZIP not crawled within the maximum interval, however poor its history', () => {
  const picked = selectZips([
    { zip_code: '00001', ewma_yield: 0, consecutive_zero: 99, last_crawled_at: daysAgo(40) },
    { zip_code: '99999', ewma_yield: 50, consecutive_zero: 0, last_crawled_at: hoursAgo(1) },
  ], { limit: 1, maxIntervalDays: 30 });
  expect(picked).toContain('00001'); // the starved ZIP wins on the floor
});
```

The second test is the whole safety property. **If it is ever deleted, the
scheduler can starve a market permanently and nothing will notice**, because the
listings it would have found were never in the database to be missed.

- [ ] **Step 2: Implement the selection query**, index-backed, never scanning `listings`:

```sql
SELECT zip_code FROM zip_crawl_stats
 WHERE last_crawled_at IS NULL
    OR last_crawled_at < now() - ($2 || ' days')::interval   -- the starvation floor
 ORDER BY last_crawled_at NULLS FIRST
 LIMIT $1;
-- …unioned with the top-yield candidates due for a normal recheck.
```

- [ ] **Step 3: Shadow-run before switching.** Log what the new scheduler *would* pick alongside what the current one actually picks, for one full day, without changing behaviour. Compare predicted yield against actual.

**Do not skip this.** The premise — that yield history predicts yield — is
exactly the kind of assumption that measurement has falsified three times in
this codebase already.

- [ ] **Step 4: Switch, then measure against the audit baseline** after 24 hours: no-result share (was 64%), listings re-seen per day (was 73,905), and the freshness probe (was 76.3% within 7 days). State all three.

- [ ] **Step 5: Confirm the source is still not blocking.** Count real HTTP failures from structured log fields — **not** by grepping for `403`/`429`, which matches ZIP codes.

- [ ] **Step 6: Commit** — `feat(crawl): schedule by expected yield with a starvation floor`

---

## Task 3: Prove no market went dark

**Files:**
- Create: `ops/monitoring/crawl-starvation.sh`
- Create: `ops/systemd/oper-crawl-starvation.service`, `ops/systemd/oper-crawl-starvation.timer`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Write the probe.** It answers one question the yield scheduler makes urgent: *is any ZIP being starved?*

```sql
SELECT count(*) FROM zip_crawl_stats
 WHERE last_crawled_at IS NULL OR last_crawled_at < now() - interval '30 days';
```

Alert on any non-zero count, naming the worst offenders. This is the guard that
makes the deprioritisation safe to run unattended.

- [ ] **Step 2: Prove it fires and resolves**, using the established method: set the threshold so it must fire, confirm the Telegram message names the ZIPs and that the state file appears, restore, confirm RESOLVED clears it.

- [ ] **Step 3: Update `docs/HANDOFF.md` §7** with the probe and the rule it enforces — *deprioritise, never abandon* — and why. Commit — `feat(crawl): starvation probe`

---

## Task 4: Re-evaluate capacity with the new ratio

**Files:**
- Modify: `docs/perf/2026-08-crawl-throughput-audit.md`

- [ ] **Step 1: Recompute the value of a second node** using the measured post-change yield ratio. If the no-result share fell from 64% to, say, 25%, a node is now worth roughly 1.5× what it was worth before.

- [ ] **Step 2: State a recommendation on the idle nodes** — with the `SCRAPER_URLS` warning attached, because that exact variable caused a ten-hour crawl outage when `gen-env.sh`'s deny-list matched `^SCRAPER_URL` and silently swallowed it.

- [ ] **Step 3: Commit** — `docs(crawl): capacity re-evaluated against the new yield ratio`

---

## Self-Review

**Spec coverage:** the 64% waste is addressed at its cause (scheduling by
position rather than by expected yield), with the failure mode that fix
introduces — starving a quiet market — guarded by both a test (T2 Step 1) and a
probe (T3). Capacity is re-evaluated afterwards (T4) rather than being the first
move, because the audit showed a node would have bought a third of its nominal
value at the old ratio.

**Placeholder scan:** every step names files, exact SQL, and expected output.
The EWMA alpha is the one tunable left open and is given a starting value with
its reasoning. The shadow-run in T2 Step 3 exists because this plan's central
premise is an assumption, and assumptions in this repo have a poor record.

**Type consistency:** `nextStats({ ewma_yield, consecutive_zero }, yield)` and
`selectZips(rows, { limit, maxIntervalDays })` are the only new runtime
contracts, and both are pure functions over the `zip_crawl_stats` shape defined
in Task 1 — so the table, the update rule, and the scheduler share one
definition.
