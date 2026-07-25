# Rent Confidence Bands & Failure Triage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the share of active listings carrying a real rent confidence band from 59% toward the honest ceiling, give the 4,874 stuck listings a reason anyone can act on, and make band-absence a visible product state rather than a silent blank.

**Architecture:** Three separable pieces. First, triage the failures that now finally record *why* they failed. Second, extend banding to the listings that have genuine comp support — never by synthesising a band from a point estimate. Third, make the UI say plainly when a number has no band behind it, so a missing band reads as honesty rather than as a bug.

**Tech Stack:** PostgreSQL 16, TypeScript (`apps/worker` rent estimator, `apps/one` UI), LightGBM p10/p50/p90 quantile models in `services/ml`, vitest.

## The measured problem

Prod, 2026-07-25, after the 2026-07-28 coverage work landed:

| Metric | Count | Share |
|---|---|---|
| Active for-sale listings | 449,592 | — |
| …with a rent estimate | 432,634 | 96.2% |
| …with a confidence band (`rent_low` set) | **266,645** | **59.3%** |
| …with `rent_calc_status = 'failed'` | 4,874 | 1.1% |

Database-wide, after the honesty migration:

```
 rent_calc_status | count     | null_rent
------------------+-----------+-----------
 done             | 1,228,447 |         0
 not_applicable   |    87,784 |    87,784
 failed           |     6,211 |     6,170
 pending          |       179 |       179
```

Two facts shape this plan:

1. **`done` now means what it says.** The `listings_done_implies_rent` CHECK
   constraint enforces it, and 0 rows violate it. So "has an estimate" is
   trustworthy — the remaining gap is genuinely about *bands*, not estimates.
2. **The 6,211 failures are still mostly unexplained.** `rent_calc_error` exists
   now and new failures record a reason (`missing lat/lon` is already appearing),
   but the pre-existing backlog predates the column and shows
   `(no reason recorded)`. They cannot be triaged until they are retried.

A band is a claim about uncertainty. Manufacturing one from a point estimate
would make the product *look* more confident while being less truthful — the
opposite of the trust work this repo has been doing. That constraint drives
every task below.

## Global Constraints

- **Never synthesise a band from a point estimate.** A band exists only where the model's quantile outputs are backed by real comp support. If support is absent, the correct outcome is no band and a UI that says so.
- **`done` implies a non-null `estimated_rent`.** Enforced by `listings_done_implies_rent`. Any new write path must respect it or the transaction will fail — this is deliberate.
- **Every failure records a reason.** A row moving to `failed` without a `rent_calc_error` is a defect.
- **Relabel, never delete.** Rows move between `pending`/`done`/`failed`/`not_applicable`; they are never removed.
- **Batched, paced, resumable** for anything touching more than a few thousand rows, and it must not starve the crawler. Watch `ops/monitoring/db-load-budget.sh` and `ops/monitoring/crawl-health.sh` during any backfill.
- **No verdict may flip from a change that only adds information.** Adding a band to a listing must not silently change its grade or its `assessRent` verdict; if it does, that is a finding to surface, not to absorb.

---

## Task 1: Triage the failures now that they can be explained

**Files:**
- Create: `infrastructure/migrations/out-of-band/2026_07_30_repend_unexplained_failures.sql`
- Create: `docs/perf/2026-07-rent-failure-triage.md`
- Reference: `apps/worker/src/rent-settle-sql.ts` (the settle statements and their reasons)

**Interfaces:**
- Produces: a reason for every `failed` row, and the count of the irreducible floor for Task 2.

- [ ] **Step 1: Establish the current split.** Nothing here is guesswork — measure first:

```sql
SELECT COALESCE(rent_calc_error, '(no reason recorded)') AS reason,
       count(*) AS n,
       count(*) FILTER (WHERE listing_status = 'active') AS active
  FROM listings WHERE rent_calc_status = 'failed'
 GROUP BY 1 ORDER BY 2 DESC;
```

Record the output verbatim in the triage doc.

- [ ] **Step 2: Determine what the unexplained failures are actually missing**, so the re-queue is not just churn:

```sql
SELECT count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) AS no_geo,
       count(*) FILTER (WHERE bedrooms IS NULL) AS no_beds,
       count(*) FILTER (WHERE sqft IS NULL) AS no_sqft,
       count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                         AND bedrooms IS NOT NULL AND sqft IS NOT NULL) AS looks_scoreable,
       count(*) AS total
  FROM listings
 WHERE rent_calc_status = 'failed' AND rent_calc_error IS NULL;
```

`looks_scoreable` is the recoverable bucket. If it is ~0, the backlog is
genuinely stuck and Step 3 re-queues only to *record reasons* — say so in the
doc rather than implying a coverage win that will not come.

- [ ] **Step 3: Re-queue the unexplained failures in bounded batches.** They will either succeed or fail *with a reason* this time:

```sql
-- Bounded on purpose: the estimator drains `pending` continuously, and dumping
-- 6,211 rows in at once competes with live crawl ingestion for the same queue.
UPDATE listings
   SET rent_calc_status = 'pending', updated_at = NOW()
 WHERE id IN (
   SELECT id FROM listings
    WHERE rent_calc_status = 'failed' AND rent_calc_error IS NULL
    ORDER BY id LIMIT 2000
 );
```

Run it, wait for the queue to drain (`SELECT count(*) FROM listings WHERE
rent_calc_status='pending'` returns to near 0), then repeat until no
`rent_calc_error IS NULL` failures remain. Watch the crawl SLOs between
batches.

- [ ] **Step 4: Re-run Step 1 and record the new split.** Every `failed` row must now carry a reason. State the irreducible floor — the count that cannot be estimated no matter what — and *why*, by reason.

- [ ] **Step 5: Commit** — `docs(rent): failure triage — every stuck listing now says why`

---

## Task 2: Extend bands where comp support is real

**Files:**
- Modify: `apps/worker/src/rent-estimator.ts` (the band-producing path)
- Test: `apps/worker/src/rent-bands.test.ts` (create)
- Reference: `services/ml` quantile model outputs (p10/p50/p90)

**Interfaces:**
- Consumes: the failure floor from Task 1.
- Produces: `rent_low`/`rent_high` on listings that have sufficient support; unchanged NULLs where they do not.

- [ ] **Step 1: Find out why 40% of estimated listings have no band.** This is the load-bearing question of the whole task, and the answer determines whether the rest is possible:

```sql
SELECT rent_model_version,
       count(*) AS n,
       count(*) FILTER (WHERE rent_low IS NOT NULL) AS banded
  FROM listings
 WHERE listing_status='active' AND listing_type='for_sale'
   AND estimated_rent IS NOT NULL
 GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
```

If unbanded rows cluster in specific `rent_model_version` values, they were
scored by a model or code path that never emitted quantiles — that is a
re-scoring job. If they are spread evenly, the band is being dropped somewhere
in the write path — that is a bug. **These have different fixes; do not proceed
until you know which it is.** Record the finding.

- [ ] **Step 2: Write the failing test for the invariant that matters.**

```ts
import { describe, it, expect } from 'vitest';
import { bandFor } from './rent-bands';

describe('bandFor', () => {
  it('returns a band when the model gives real quantiles', () => {
    expect(bandFor({ p10: 1200, p50: 1500, p90: 1900, compCount: 12 }))
      .toEqual({ rent_low: 1200, rent_high: 1900 });
  });

  it('returns NO band when comp support is too thin', () => {
    expect(bandFor({ p10: 1200, p50: 1500, p90: 1900, compCount: 1 })).toBeNull();
  });

  it('never fabricates a band from the point estimate alone', () => {
    expect(bandFor({ p10: null, p50: 1500, p90: null, compCount: 50 })).toBeNull();
  });

  it('rejects a degenerate band where the quantiles collapsed', () => {
    expect(bandFor({ p10: 1500, p50: 1500, p90: 1500, compCount: 50 })).toBeNull();
  });

  it('rejects an inverted band rather than silently swapping it', () => {
    expect(bandFor({ p10: 1900, p50: 1500, p90: 1200, compCount: 50 })).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and watch it fail.**

```bash
pnpm --filter @oper/worker test --run src/rent-bands
```

Expected: FAIL — `Cannot find module './rent-bands'`.

- [ ] **Step 4: Implement `bandFor` in `apps/worker/src/rent-bands.ts`.** Keep it a pure function with no database or network access, so it is trivially testable and can be reused by any scoring path:

```ts
/** Minimum comps before an interval means anything. */
const MIN_COMP_SUPPORT = 3;

export interface QuantileOutput {
  p10: number | null;
  p50: number | null;
  p90: number | null;
  compCount: number;
}

/**
 * A band is a claim about uncertainty. It is returned ONLY when the model
 * actually produced quantiles over enough comps to mean something — never
 * derived from the point estimate, which would make the product look more
 * confident while being less truthful.
 */
export function bandFor(q: QuantileOutput): { rent_low: number; rent_high: number } | null {
  if (q.compCount < MIN_COMP_SUPPORT) return null;
  if (q.p10 === null || q.p90 === null) return null;
  if (!Number.isFinite(q.p10) || !Number.isFinite(q.p90)) return null;
  if (q.p90 <= q.p10) return null; // degenerate or inverted — not a band
  return { rent_low: q.p10, rent_high: q.p90 };
}
```

- [ ] **Step 5: Run the tests.** Expected: 5 passed.

- [ ] **Step 6: Wire `bandFor` into the estimator's write paths** so both the single-row and bulk paths use it, replacing any inline band logic. Verify no other code decides band presence:

```bash
grep -rn "rent_low" apps/worker/src | grep -v "\.test\."
```

- [ ] **Step 7: Re-score the unbanded population** identified in Step 1, using the existing queue, batched and paced exactly as `ops/db/backfill-rent-bands.sh` does. Do not write a new backfill mechanism — that script already handles pacing, resumability, and queue-depth backpressure.

- [ ] **Step 8: Verify no verdict flipped.** Sample 200 listings that had a band before this change and confirm their `assessRent` verdict is unchanged. A verdict that moves because the band logic was centralised is a real finding — surface it, do not absorb it.

- [ ] **Step 9: Commit** — `feat(rent): real confidence bands wherever comp support allows`

---

## Task 3: Make band-absence a first-class product state

**Files:**
- Modify: the deal/property page rent display in `apps/one/src/app/property/[id]/`
- Modify: wherever `assessRent` consumes band inputs (`grep -rn "assessRent" apps/one/src packages`)
- Test: alongside the existing property page tests

**Interfaces:**
- Consumes: `rent_low`/`rent_high` being legitimately null for some listings.

- [ ] **Step 1: Find every place a band is rendered or assumed.**

```bash
grep -rn "rent_low\|rent_high\|assessRent" apps/one/src packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\."
```

- [ ] **Step 2: Write the failing test** — a listing with an estimate but no band must render an explicit, honest state, not a blank or a `$NaN`:

```tsx
it('says plainly when a rent estimate has no confidence band', () => {
  render(<RentEstimate estimatedRent={1500} rentLow={null} rentHigh={null} />);
  expect(screen.getByText(/1,500/)).toBeInTheDocument();
  expect(screen.getByText(/point estimate|no range|not enough comps/i)).toBeInTheDocument();
  expect(screen.queryByText(/NaN|\$0\b|undefined/)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run it and watch it fail.**

- [ ] **Step 4: Implement the honest state.** Reuse the existing point-estimate treatment from the trust work rather than inventing a new visual language — check `git log --oneline --grep=trust` for the components involved.

- [ ] **Step 5: Make `assessRent` treat band-absence as a first-class input**, not a silent default. If it currently coerces a missing band to a default width, that default is inventing confidence — remove it and give the function an explicit `bandAbsent` path.

- [ ] **Step 6: Run the full suite and typecheck.**

```bash
pnpm --filter @oper/one test --run && pnpm --filter @oper/one exec tsc --noEmit
```

- [ ] **Step 7: Commit** — `feat(rent): band-absence is an honest state, not a blank`

---

## Task 4: Coverage probe and deploy proof

**Files:**
- Create: `ops/monitoring/rent-coverage.sh`
- Create: `ops/systemd/oper-rent-coverage.service`, `ops/systemd/oper-rent-coverage.timer`
- Modify: `docs/HANDOFF.md` §7

- [ ] **Step 1: Write the probe.** Alert when banded share of active listings drops below a floor set just under the level Task 2 achieves (set the number *after* measuring — a floor invented in advance either never fires or fires forever):

```bash
BANDED_MIN_PCT="${RENT_BANDED_MIN_PCT:-<measured value minus 5>}"
```

Follow `ops/monitoring/photo-coverage.sh` / `db-load-budget.sh` structure:
`--key`, `--resolved`, and an `EXPLAIN` check that the query is index-backed and
not a sequential scan of `listings`.

- [ ] **Step 2: Prove it fires and resolves** by temporarily setting the floor above the real value, confirming the Telegram message and the `/var/lib/oper-alerts/` state file, then restoring and confirming RESOLVED clears the file.

- [ ] **Step 3: Deploy and verify on prod.** Re-run the exact coverage query from the top of this plan and state the new numbers:

```sql
SELECT count(*) FILTER (WHERE rent_low IS NOT NULL) AS banded,
       count(*) AS active
  FROM listings WHERE listing_type='for_sale' AND listing_status='active';
```

- [ ] **Step 4: Confirm the new work did not become a load problem.**

```bash
/opt/onepercent/ops/monitoring/db-load-budget.sh
curl -H "Authorization: Bearer $ADMIN_API_KEY" localhost:3001/api/admin/perf
```

Neither the re-scoring nor the probe may appear as a new top query, and no
route's p95 may breach `docs/perf/perf-budgets.md`.

- [ ] **Step 5: Update `docs/HANDOFF.md` §7** with the probe and the meaning of the banded-share number. Commit — `feat(rent): banded-coverage probe + handoff notes`

---

## Self-Review

**Spec coverage:** the 59% band gap is addressed by cause rather than by
symptom — T1 explains and clears the failures, T2 extends bands only where
support is real, T3 makes the remaining absence honest instead of blank, T4
stops the number from silently regressing. The plan explicitly refuses the
shortcut (synthesising bands) that would close the metric while damaging the
product.

**Placeholder scan:** every step has real SQL, real commands, and expected
output. Two values are deliberately deferred with a stated reason: the
`bandFor` comp threshold is a constant in the code where it can be tuned, and
the probe's floor is set from T2's measured result — inventing that floor
before measuring is precisely how `db-load-budget.sh` first shipped alerting
forever on an idle database.

**Type consistency:** `bandFor(QuantileOutput): { rent_low, rent_high } | null`
is the single new contract, used by both estimator write paths; `rent_low`/
`rent_high` remain `number | null` in the database and in every UI prop, so
band-absence is representable end to end rather than needing a sentinel.
