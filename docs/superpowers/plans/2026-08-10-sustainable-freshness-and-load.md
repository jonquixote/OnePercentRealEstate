# Sustainable Freshness & Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the freshness SLO achievable and the database load budget meaningful — by fixing the causes, not by widening the thresholds. No reduction in data fullness, coverage, or quality.

**Architecture:** Four independent corrections, ordered by how much they cost to get wrong. Fix the metric definitions that are internally inconsistent (free, and they currently make the SLO unachievable by construction). Fix the monitoring that costs more than it measures. Rebalance the crawl budget toward what the SLO actually measures, without dropping any data stream. Only then consider capacity.

**Tech Stack:** PostgreSQL 16, `apps/worker` (lifecycle + crawl orchestration), `services/scraper_service`, bash ops probes, systemd timers.

## Measurements — taken 2026-07-27, before any change

### 1. The freshness SLO is unachievable by construction

| quantity | value |
|---|---|
| active for-sale listings | 548,811 |
| confirmations needed for a 7-day sweep | **3,267 / hour** (78,402/day) |
| confirmations actually achieved | **1,898 / hour** (45,550/day) |
| shortfall | **we run at 58% of the required rate** |

And the unconfirmed population is not randomly distributed:

| age of unconfirmed active listings | count |
|---|---|
| **7–8 days** | **78,684** |
| **8–10 days** | **66,589** |
| 10–14 days | 2,336 |
| 30 days+ / never | 3 |

**145,273 of 147,647 (98.4%) sit in the 7–10 day band.** That band exists because
two thresholds disagree:

- `STALE_AFTER_DAYS = 10` — the reaper keeps a listing **active** until unseen for 10 days.
- `FRESHNESS_WINDOW_DAYS = 7` — the probe calls a listing **unconfirmed** past 7 days.

So every listing between 7 and 10 days unseen is simultaneously "active" and
"unconfirmed" *by design*. Even a perfect crawl running exactly at the reaper's
tolerance would report a permanently failing SLO. **This is a defect in my own
instrumentation, introduced when the probe was written with a window nobody
reconciled against the reaper.**

Also confirmed, so the cause is not misattributed: **0** of the 147,647
unconfirmed were discovered in the last 7 days. This is not dilution from
`past_days=90` finding new inventory.

### 2. The load budget is measuring scheduled maintenance, not a runaway query

Background DB work per hour, measured:

| job | cadence | cost each | per hour |
|---|---|---|---|
| `stats-refresh` (4 strategies) | 30 min | ~20 s × 4 | **160 s** |
| `mv_cluster_tiles` refresh | 30 min | 43 s | **86 s** |
| `mv_market_grid` refresh | 30 min | 35 s | **70 s** |
| `rent-coverage` probe | 30 min | **9.65 s** | 19.3 s |
| `crawl-health` | 10 min | 2.13 s | 12.8 s |
| `photo-coverage` | 30 min | 2.84 s | 5.7 s |
| `inventory-freshness` | 60 min | 3.22 s | 3.2 s |
| `db-load-budget` | 60 min | 0.76 s | 0.8 s |
| **total** | | | **≈ 358 s/hour** |

Against a database whose only other significant work is a crawl doing ~1,898
confirmations an hour, that maintenance load **is** the majority of DB time. The
budget alert fires at 39–41% every window because it is correctly reporting that
scheduled batch work dominates a mostly-idle database.

The absolute floor (>60 s) was added precisely to stop percentage-only
false-positives on an idle DB — but these jobs genuinely exceed 60 s, so the
floor does not filter them.

**`rent-coverage.sh` is the worst offender per unit of value: a Parallel Seq Scan
over the whole 11 GB table, 9.65 s, twice an hour — a probe I wrote, to assert an
invariant that has been zero every single time it has run.**

### 3. The crawl budget is split four ways; one way feeds the SLO

Scrape passes observed over 30 minutes:

| pass | scrapes | confirms rows in `listings`? |
|---|---|---|
| `for_sale` | 187 | **yes — 45,653 in 24 h** |
| `for_rent` | 93 | no — writes `rental_listings` |
| `pending` | 94 | negligible — 11 in 24 h |
| `sold` | 94 | no — writes `sold_listings` |

Roughly **five passes per ZIP**, of which the `for_sale` pass is the only one the
freshness SLO measures. The other streams are *not waste* — `for_rent` feeds the
rent-model comps and `sold` feeds sold comps and the sold matcher. **They must not
be dropped.** But they are being run at the same cadence as the stream with the
tightest freshness requirement, which is a scheduling choice nobody made
deliberately.

### 4. Two per-row `is_rentable()` callers survived the stats fix

`apps/one/src/app/api/featured/route.ts:78` and
`apps/one/src/lib/queries/properties.ts:75` still call
`public.is_rentable(property_type)` per row — the same plpgsql function with
`procost 100` whose removal took the stats aggregate from 25.7 s to 9.5 s.

## Global Constraints

- **No threshold may be widened to make an alert stop firing.** If a window changes, it changes because the *definition* was wrong, and the reasoning is recorded. Silencing is forbidden.
- **No data stream may be dropped.** `for_rent`, `sold` and `pending` all feed real consumers. Cadence may change; coverage may not shrink.
- **No reduction in freshness, coverage, or quality to buy load headroom.** If a change trades one for the other, it does not ship.
- **Every probe must cost less than the thing it protects.** A monitoring query that seq-scans an 11 GB table twice an hour is the failure mode this whole effort exists to prevent.
- **Measure before and after, on prod, and record both numbers.** Not "should be faster".
- **Bounded, paced, resumable** for anything touching many rows; watch `db-load-budget.sh` and `crawl-health.sh` throughout.
- Latency budgets in `docs/perf/perf-budgets.md` bind.

---

## Task 1: Reconcile the freshness window with the reaper

**Files:**
- Modify: `ops/monitoring/inventory-freshness.sh`
- Create: `docs/perf/2026-08-freshness-window-decision.md`

**Interfaces:**
- Produces: a freshness SLO that a correctly-functioning system can actually satisfy.

**This is not widening a threshold to silence an alert.** The probe and the reaper
currently encode two different definitions of "active", and the probe's is
stricter than the one the system is built to. 98.4% of the reported failure is
that disagreement.

- [ ] **Step 1: State the decision explicitly before changing code.** Write the
      decision record answering: *what should "active" mean?* Three options, and
      the reasoning for the choice:

  - **(a) Probe measures 10 days, matching `STALE_AFTER_DAYS`.** The SLO then
    asks "is the reaper's promise being kept?" — a question the system can
    answer. Honest, and immediately meaningful.
  - **(b) Reaper tightens to 7 days.** Makes the probe right, but would demote
    ~145,273 listings that the source still lists — sacrificing fullness, which
    this plan forbids.
  - **(c) Keep both, report the band separately.** Most informative, most
    complex.

  **Recommend (a), and additionally report the 7-day number as a secondary,
  non-alerting figure** so the tighter target stays visible without producing a
  permanently-red alert. Record why (b) is rejected: it would delete real
  inventory from the product to make a number look better.

- [ ] **Step 2: Implement.** `FRESHNESS_WINDOW_DAYS` defaults to 10 and is
      derived from the same source as `STALE_AFTER_DAYS` where possible, so the
      two cannot drift apart again. Emit both figures in the probe's stdout line;
      alert only on the 10-day one.

- [ ] **Step 3: Verify the new number against the measured distribution.** With a
      10-day window the unconfirmed population should fall to roughly
      2,336 + 3 ≈ 2,339 rows (the 10-day-plus band), i.e. **~99.6% confirmed.**
      If the measured result differs materially from that arithmetic, stop — the
      probe is measuring something other than what this analysis assumed.

- [ ] **Step 4: Set the floor from the achieved value with headroom**, not from a
      round number, and record both. Commit —
      `fix(monitoring): freshness window matches the reaper's definition of active`

---

## Task 2: Make the probes cost less than what they protect

**Files:**
- Modify: `ops/monitoring/rent-coverage.sh`
- Modify: `ops/systemd/oper-rent-coverage.timer`, `oper-photo-coverage.timer`
- Create: `infrastructure/migrations/2026_08_10_band_integrity_index.sql`

**Interfaces:**
- Produces: the same assertions at a small fraction of the DB cost.

- [ ] **Step 1: Measure each probe's query plan before changing it**, and record
      the plan type (seq scan vs index) alongside the timing already gathered:

```bash
sudo -u postgres psql -d postgres -c "EXPLAIN (ANALYZE, BUFFERS) <the band-integrity query>"
```

Known: the band-integrity query is a **Parallel Seq Scan, 9.3 s**.

- [ ] **Step 2: Make the band-integrity assertion index-backed.** It asks whether
      any row violates four invariants that have been zero on every run. A
      partial index on exactly the violating predicate makes the check an
      index-only lookup that stays free as the table grows:

```sql
-- A partial index whose predicate IS the violation. It indexes only rows that
-- are already broken — normally zero rows, so it costs nothing to maintain and
-- turns a 9.3s Parallel Seq Scan into an index probe.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_band_violations
  ON listings (id)
  WHERE (rent_low IS NOT NULL) <> (rent_high IS NOT NULL)
     OR (rent_low IS NOT NULL AND rent_high <= rent_low)
     OR (rent_low IS NOT NULL AND estimated_rent NOT BETWEEN rent_low AND rent_high);
```

`CREATE INDEX CONCURRENTLY` cannot run inside a transaction and the migration
runner wraps files in one — so this goes in
`infrastructure/migrations/out-of-band/`.

- [ ] **Step 3: Verify the plan changed and the answer did not.** Both the old and
      new query must return the same count (0), and the plan must show an index
      scan. **If the count differs, stop** — the index predicate does not match
      the query predicate.

- [ ] **Step 4: Re-time the probe.** Record before/after. Expected: 9.65 s → well
      under 1 s.

- [ ] **Step 5: Set cadences from how fast each number can actually move.**
      Coverage figures move on crawl cadence (hours), not minutes:
      `rent-coverage` and `photo-coverage` go from 30 min to hourly. Record the
      reasoning; do not simply slow everything down to reduce load, only the
      probes whose subject genuinely moves slowly.

- [ ] **Step 6: Commit** — `perf(monitoring): probes cost less than what they protect`

---

## Task 3: Set background cadence from how fast the data actually moves

**Files:**
- Modify: `ops/systemd/oper-stats-refresh.timer`
- Modify: `CLUSTER_REFRESH_INTERVAL_MS` via `ops/systemd/gen-env.sh`
- Modify: `apps/one/src/app/api/featured/route.ts`, `apps/one/src/lib/queries/properties.ts`
- Create: `docs/perf/2026-08-background-load-budget.md`

**Interfaces:**
- Produces: background DB load proportionate to how fast its inputs change.

- [ ] **Step 1: Finish the `is_rentable` hoist.** Two callers still evaluate it
      per row. Apply the same fix that took the stats aggregate from 25.7 s to
      9.5 s — resolve once per distinct `property_type` and join. **Measure each
      before and after and confirm identical output**, as the stats fix did
      (585,575 / 65,048 / 530,135 both ways).

- [ ] **Step 2: Establish how fast the refreshed data actually changes.** Before
      touching any cadence, measure how much `stats_summary` and the two MVs
      actually move between consecutive refreshes:

```sql
-- Do the hero numbers differ between two refreshes 30 minutes apart?
SELECT * FROM stats_summary ORDER BY computed_at DESC LIMIT 3;
```

**If the numbers move materially every 30 minutes, do not slow the refresh** —
the cadence is justified and the load must be reduced another way. Record the
observed deltas either way. This is the measurement that decides Step 3.

- [ ] **Step 3: Set each cadence from Step 2's evidence.** Candidate targets, to
      be confirmed or rejected by measurement:
      `stats-refresh` 30 min → 60 min (160 s/hr → 80 s/hr);
      cluster/market MV refresh 30 min → 60 min (156 s/hr → 78 s/hr).

      Both are served through `cachedSWR`, so a longer refresh interval does not
      make any user wait — it only makes the cached value older. State the
      staleness this introduces in user-visible terms.

- [ ] **Step 4: Re-measure total background load per hour** with the same method
      as the baseline table, and record before/after. Target: ~358 s/hour → under
      200 s/hour **without** any probe losing its assertion.

- [ ] **Step 5: Confirm the budget alert reflects reality.** After the change,
      `db-load-budget.sh` should stop firing on scheduled maintenance while still
      being able to catch a genuine runaway. **Verify the second half explicitly**
      — run a deliberately expensive query and confirm the probe still flags it.
      An alert that no longer fires because everything got quieter is
      indistinguishable from an alert that is broken.

- [ ] **Step 6: Commit** — `perf(background): cadence set from how fast the data moves`

---

## Task 4: Rebalance the crawl budget without dropping any stream

**Files:**
- Modify: the crawl scheduler in `apps/worker`
- Create: `docs/perf/2026-08-crawl-pass-balance.md`

**Interfaces:**
- Produces: more `for_sale` confirmations per unit of crawl capacity, with every
  other stream still covered.

- [ ] **Step 1: Establish what each stream is worth and how fast it decays.**
      Measure, per stream: rows written in 24 h, and how many are *new* versus
      re-confirmations:

```sql
SELECT 'rental_listings' t, count(*) FILTER (WHERE created_at > now()-interval '24 hours') new_24h, count(*) total FROM rental_listings
UNION ALL SELECT 'sold_listings', count(*) FILTER (WHERE created_at > now()-interval '24 hours'), count(*) FROM sold_listings;
```

**A stream that adds few rows per day does not need the same cadence as one under
a 7-day freshness SLO** — but the decision must come from this measurement, not
from the assumption.

- [ ] **Step 2: Write the failing test for the pass scheduler**, pinning the
      property that matters — every stream still gets visited within its own
      bounded interval:

```ts
it('visits every stream within its maximum interval', () => {
  // for_sale is the SLO-bearing stream and gets the tightest cadence;
  // no stream may be starved, however cheap it looks.
  const plan = passPlan({ zip: '44120', now, lastSeen: { for_sale: hoursAgo(1), for_rent: daysAgo(30), sold: daysAgo(30) } });
  expect(plan).toContain('for_rent');
  expect(plan).toContain('sold');
});

it('prioritises for_sale when everything is equally due', () => {
  const plan = passPlan({ zip: '44120', now, lastSeen: { for_sale: daysAgo(8), for_rent: daysAgo(8), sold: daysAgo(8) } });
  expect(plan[0]).toBe('for_sale');
});
```

- [ ] **Step 3: Implement per-stream cadence**, with `for_sale` on the tightest
      interval and the others on intervals justified by Step 1. Record the
      expected `for_sale` confirmation rate: if `for_sale` goes from ~40% to ~70%
      of passes, the rate should rise from 1,898/hr toward ~3,300/hr — which is
      the SLO requirement.

- [ ] **Step 4: Measure for a full day and compare against every stream's
      coverage**, not just the headline. Required evidence:
      `for_sale` confirmations/hour up; **`rental_listings` and `sold_listings`
      row growth not materially down.** If any stream's coverage fell, the change
      traded quality for a metric and must be reverted.

- [ ] **Step 5: Commit** — `feat(crawl): per-stream cadence — for_sale carries the SLO`

---

## Task 5: Re-measure everything, and say what is still short

**Files:**
- Create: `docs/perf/2026-08-freshness-load-results.md`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Reproduce the four baseline tables** from the top of this plan with
      identical queries, and put before/after side by side.

- [ ] **Step 2: State plainly what is still short.** If freshness is achievable but
      the crawl still cannot sustain a 7-day sweep at 100%, say so with the
      number, and point at `2026-08-07-incremental-crawl.md` as the remaining
      lever. **Do not present a reconciled window as if it were a throughput
      improvement** — they are different achievements and conflating them would
      be exactly the patchwork this plan exists to avoid.

- [ ] **Step 3: Update `docs/HANDOFF.md` §7** with the corrected SLO definitions,
      the background load budget, and the rule that a probe must cost less than
      what it protects.

- [ ] **Step 4: Commit** — `docs(perf): freshness and load results, and what remains`

---

## Self-Review

**Spec coverage:** each measured cause is addressed by exactly one task — the
window mismatch (T1), probe cost (T2), background cadence and the surviving
per-row function calls (T3), crawl budget allocation (T4) — and T5 forces an
honest accounting of what is still short. No task widens a threshold to silence
an alert; T1 changes a definition and records why, and explicitly rejects the
option that would sacrifice inventory.

**Placeholder scan:** every task names files, exact SQL, and what to record. Two
values are deliberately derived rather than asserted: the background cadences
(T3 Step 3 is gated on the Step 2 measurement, and the plan explicitly says not
to slow a refresh whose data genuinely moves) and the per-stream intervals (T4
Step 1). Inventing either would repeat the mistake that produced a 7-day probe
against a 10-day reaper.

**Type consistency:** `passPlan({ zip, now, lastSeen })` is the only new runtime
contract; `FRESHNESS_WINDOW_DAYS` and `STALE_AFTER_DAYS` become linked rather
than independent, which is the specific coupling whose absence caused the false
SLO.
