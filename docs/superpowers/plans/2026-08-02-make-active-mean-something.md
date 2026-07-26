# Make "Active" Mean Something Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop presenting 101,864 listings as "active" when nothing has confirmed they exist in over a week — either by crawling fast enough to verify them, or by saying plainly how fresh each one is.

**Architecture:** Three pieces in dependency order. First measure why the crawl only covers ~74k listings a day against 446k of active inventory. Then raise throughput using capacity that already exists but is not configured. Then, for whatever staleness remains irreducible, surface it honestly in the product instead of letting "active" imply "verified today".

**Tech Stack:** `services/scraper_service` (FastAPI + homeharvest), `apps/worker` crawl orchestration, PostgreSQL 16, Next 16 (`apps/one`), bash ops probes.

## The measured problem

Prod, 2026-07-26, active for-sale listings (446,270 total):

| Last confirmed by the crawler | Count | Share |
|---|---|---|
| under 1 day | 56,355 | 12.6% |
| 1–3 days | 74,555 | 16.7% |
| 3–7 days | 213,339 | **47.8%** |
| 7–30 days | **101,864** | **22.8%** |
| over 30 days / never | 3 | ~0% |

**Only 29% of inventory the product calls "active" has been confirmed in the
last three days.** Nearly a quarter has not been seen in over a week.

Throughput over the last 24 hours: **73,905 listings re-seen, 25,391 new**. At
~74k/day against 446k active rows, a full sweep takes roughly **six days** —
which is exactly the shape of the table above. The distribution is not random
decay; it is the sweep interval.

And the crawl is running on **one node**:

```
SCRAPER_URLS=http://127.0.0.1:8001
```

A single local scraper. Prior sessions provisioned additional nodes and recorded
them as idle pending the stateless-nodes work (PR #85). Whatever the ban limits
are, the current configuration cannot be the throughput ceiling if capacity is
sitting unused.

## Why this matters more than it looks

For a real-estate product, a listing unconfirmed for 7–30 days may well be under
contract, sold, or withdrawn. The product shows it as active, ranks it, and
includes it in deal alerts. A user who calls about a property that sold two
weeks ago does not conclude "the crawl interval is six days" — they conclude the
data cannot be trusted, and that judgement extends to every number on the page.

This is the same class of problem as the `rent_calc_status = 'done'` rows that
held no estimate, and the listings whose photos existed but were unreadable:
**a field that says one thing while the data says another.** Those were fixed by
making the status honest. This one is larger because the honest answer may be
"we don't know", and the product has no way to express that yet.

## Global Constraints

- **Relabel, never delete.** Listings move between lifecycle states; they are never removed. `/property/[id]` must keep rendering a stale listing — old links and search traffic depend on it.
- **Do not weaken the reaper by widening its window.** If listings are going stale because the crawl is slow, the fix is crawl throughput or honest labelling — not a longer staleness threshold, which would just hide the problem.
- **Respect the source's limits.** Realtor is ban-limited; measure the actual ceiling before assuming more nodes multiply throughput linearly. A ban costs more than a slow crawl.
- **Crawl changes must not starve the database.** Watch `ops/monitoring/db-load-budget.sh` and `ops/monitoring/crawl-health.sh` throughout; the crawl shares Postgres with both apps.
- **No new unbounded background work.** Freshness probes are O(index) — `listings` is 11 GB and a full scan per probe is the mistake that once cost 79% of all database time.
- Latency budgets in `docs/perf/perf-budgets.md` bind; nothing here may push a route's p95 past its budget.

---

## Task 1: Find the real throughput ceiling

**Files:**
- Create: `docs/perf/2026-08-crawl-throughput-audit.md`
- Read: `services/scraper_service/main.py`, `ops/scraper-node/README.md`, the crawl orchestration in `apps/worker`

**Interfaces:**
- Produces: the measured per-node ceiling and the reason for it, which gates Task 2.

- [ ] **Step 1: Establish the baseline precisely**, so any change can be attributed:

```sql
SELECT date_trunc('hour', last_seen_at) AS hr, count(*)
  FROM listings WHERE last_seen_at > now() - interval '24 hours'
 GROUP BY 1 ORDER BY 1;
```

Record the hourly shape. A flat line means a rate limit; a spiky one means
scheduling gaps. **These have different fixes — do not proceed until you know
which.**

- [ ] **Step 2: Find out what actually limits a single node.** Check the crawl-health probe's own numbers and the scraper's error taxonomy:

```bash
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 \
  "/opt/onepercent/ops/monitoring/crawl-health.sh; journalctl -u oper-scraper --since '24 hours ago' --no-pager | grep -ciE 'ban|429|403|blocked'"
```

Record: requests attempted, succeeded, and the count and kind of blocks. If the
node is being banned, more nodes multiply the ban rather than the throughput —
say so plainly and let that shape Task 2.

- [ ] **Step 3: Determine whether inventory is being re-crawled evenly or unevenly.** A six-day mean sweep could be uniform, or it could be some ZIPs daily and others monthly:

```sql
SELECT width_bucket(extract(epoch from now() - last_seen_at)/86400, 0, 30, 6) AS days_bucket,
       count(DISTINCT zip_code) AS zips, count(*) AS listings
  FROM listings WHERE listing_status='active' AND listing_type='for_sale'
 GROUP BY 1 ORDER BY 1;
```

Uneven coverage is a scheduling bug and is fixable without any new capacity —
which would make Task 2 unnecessary. Check before buying hardware.

- [ ] **Step 4: Locate the idle nodes and establish whether they are usable.** Read `ops/scraper-node/README.md` and the notes on PR #85, then verify against reality — do the hosts still exist, are they reachable, is the service installed?

- [ ] **Step 5: Write the audit.** State the ceiling, the reason for it, and a recommendation: more nodes, better scheduling, or accept the interval and go straight to Task 3. **Recommend one**, do not list options.

- [ ] **Step 6: Commit** — `docs(crawl): throughput audit — what actually limits the sweep`

---

## Task 2: Raise throughput, gated on Task 1

**Files:**
- Modify: `/etc/oper.env` on the prod box (`SCRAPER_URLS`), via `ops/systemd/gen-env.sh`
- Modify: whatever schedules crawl work in `apps/worker`
- Reference: `ops/scraper-node/README.md`

**Interfaces:**
- Consumes: Task 1's recommendation. **If Task 1 concluded the limit is bans or scheduling, skip to the relevant sub-step and record why.**

- [ ] **Step 1: If the limit is scheduling** — fix the distribution so every ZIP is swept on a comparable interval, rather than some starving. Add a test that the scheduler's selection covers the full ZIP set within one nominal sweep.

- [ ] **Step 2: If the limit is node count** — bring the idle nodes into `SCRAPER_URLS`.

  **This is the exact variable that caused a ~10-hour crawl outage**: `gen-env.sh` had a deny-list matching `^SCRAPER_URL`, which silently swallowed `SCRAPER_URLS` and left the crawl dead with 290 errors and 0 successes. Before deploying, verify the generated env actually contains every node:

```bash
ssh -i ~/.ssh/id_onepercent root@209.50.61.64 "grep SCRAPER_URLS /etc/oper.env"
```

Expected: all node URLs, comma-separated. **If the variable is missing or
truncated, stop** — that is the outage repeating.

- [ ] **Step 3: Verify each node independently answers before trusting the pool:**

```bash
for u in $NODE_URLS; do printf "%s " "$u"; curl -s -o /dev/null -w '%{http_code}\n' -m 10 "$u/health"; done
```

- [ ] **Step 4: Measure the change against Task 1's baseline** after a full day, using the same hourly query. State the new listings/day and the implied sweep interval.

- [ ] **Step 5: Confirm nothing else degraded.** More crawl means more writes to a database shared with both apps:

```bash
/opt/onepercent/ops/monitoring/db-load-budget.sh
/opt/onepercent/ops/monitoring/crawl-health.sh
curl -H "Authorization: Bearer $ADMIN_API_KEY" localhost:3001/api/admin/perf
```

No new top query, no route over budget, and the ban rate from Task 1 Step 2 must
not have risen.

- [ ] **Step 6: Commit** — `feat(crawl): raise sweep throughput` (state the before/after listings/day in the message)

---

## Task 3: Say how fresh a listing is

**Files:**
- Create: `apps/one/src/lib/freshness.ts`, `apps/one/src/lib/freshness.test.ts`
- Modify: the property page and card components
- Modify: `docs/HANDOFF.md` §6 (listing lifecycle)

**Interfaces:**
- Produces: `freshnessOf(lastSeenAt: Date | string | null, now?: Date): Freshness`

- [ ] **Step 1: Write the failing test.** This is pure date arithmetic that will render on every card, so pin the boundaries exactly:

```ts
import { describe, it, expect } from 'vitest';
import { freshnessOf } from './freshness';

const now = new Date('2026-08-02T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('freshnessOf', () => {
  it('is verified within a day', () => {
    expect(freshnessOf(ago(6), now).level).toBe('verified');
  });

  it('is recent between one and three days', () => {
    expect(freshnessOf(ago(48), now).level).toBe('recent');
  });

  it('is aging between three and seven days', () => {
    expect(freshnessOf(ago(120), now).level).toBe('aging');
  });

  it('is unconfirmed beyond seven days — the honest word for it', () => {
    expect(freshnessOf(ago(24 * 10), now).level).toBe('unconfirmed');
  });

  it('treats a missing timestamp as unconfirmed, never as fresh', () => {
    expect(freshnessOf(null, now).level).toBe('unconfirmed');
  });

  it('never reports a future timestamp as stale', () => {
    expect(freshnessOf(new Date(now.getTime() + 3600_000), now).level).toBe('verified');
  });

  it('exposes the age in days for display', () => {
    expect(freshnessOf(ago(72), now).days).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter @oper/one test --run src/lib/freshness
```

- [ ] **Step 3: Implement it**, with the thresholds matching the buckets measured above so the levels describe real populations rather than invented ones.

- [ ] **Step 4: Surface it where a user makes a decision** — the property page at minimum. Reuse the honest-state treatment the trust work established for rent estimates rather than inventing new visual language; check `git log --oneline --grep=trust` for the components.

**Do not** show a green "verified" badge on the 12.6% and nothing on the rest —
that reads as decoration. The 22.8% that are unconfirmed are the ones a user
needs told.

- [ ] **Step 5: Run the full suite and typecheck**, then commit — `feat(listings): show how recently a listing was confirmed`

---

## Task 4: A freshness probe and the SLO

**Files:**
- Create: `ops/monitoring/inventory-freshness.sh`
- Create: `ops/systemd/oper-inventory-freshness.service`, `ops/systemd/oper-inventory-freshness.timer`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Set the SLO from Task 2's achieved throughput**, not from a wish. If the sweep lands at three days, the SLO is "≥X% of active inventory confirmed within three days" where X is what was actually reached, minus headroom.

- [ ] **Step 2: Write the probe**, following `ops/monitoring/photo-coverage.sh` exactly — `--key`, `--resolved`, and an `EXPLAIN` confirming the query is index-backed. `listings` is 11 GB; a sequential scan every 30 minutes is the failure mode this whole monitoring effort exists to avoid.

- [ ] **Step 3: Prove it fires and resolves** by temporarily setting the floor above the real value, confirming the Telegram message names the percentage and the unconfirmed count and that the state file appears, then restoring and confirming RESOLVED clears it.

- [ ] **Step 4: Record the SLO in `docs/HANDOFF.md` §7** alongside the other coverage probes, with one line on what to do when it fires. Commit — `feat(crawl): inventory freshness SLO + probe`

---

## Self-Review

**Spec coverage:** the gap is addressed at its three levels — why the sweep is
slow (T1), making it faster where that is actually possible (T2), and telling
the truth about whatever staleness remains (T3), with a probe so the number
cannot silently regress (T4). T3 is deliberately not gated on T2: even a perfect
crawl leaves some inventory unconfirmed, and the product currently cannot say so
at all.

**Placeholder scan:** every step names files, exact SQL, exact commands and
expected output. Task 2's branches are explicitly conditional on Task 1's
finding — the plan refuses to add scraper nodes before knowing whether the limit
is bans or scheduling, because two prior plans in this repo were built on
premises that measurement falsified. The `SCRAPER_URLS` verification in T2 Step 2
is called out because that exact variable caused a ten-hour crawl outage.

**Type consistency:** `freshnessOf(lastSeenAt: Date | string | null, now?: Date): Freshness`
where `Freshness = { level: 'verified' | 'recent' | 'aging' | 'unconfirmed'; days: number }`
is the only new runtime contract. It accepts null so it can consume
`last_seen_at` straight from a row without a guard at every call site, and
returns `unconfirmed` for null rather than defaulting to fresh.
