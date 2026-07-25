# Rent Coverage & Confidence — 10% of Inventory Can't Be Scored, 68% Has No Band

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product's entire promise is "does this property clear the 1% rule?" — which requires a rent estimate. Right now **44,564 of 447,927 active listings (10%) have no rent estimate at all**, so they cannot be scored, ranked, alerted on, or shown as deals; they are invisible to every feature that matters. Another **306,413 (68%) have no confidence band** (`rent_low`/`rent_high`), which is what the trust guardrails and the deal page's honesty rely on — without it we show a single confident-looking number we cannot qualify. And **4,838 rent calculations have failed** with nobody triaging them. The infrastructure is fast now; this plan makes it *complete*.

**Architecture:** Three separable problems, each measured before it is fixed. (1) **Coverage** — find out *why* 44k active listings have no estimate (missing inputs? never enqueued? silently dropped?) and drive it to near-zero with a backfill that respects the existing async rent-estimator queue rather than a parallel one-off script. (2) **Failures** — classify the 4,838 failures into actionable buckets and either fix, permanently mark, or retry them; a failure with no classification is just an invisible gap. (3) **Confidence** — determine what the 32% *with* a band do differently and extend that path, so the trust classifier (`assessRent`) can qualify far more listings instead of defaulting to a bare point estimate.

**Tech Stack:** `apps/worker/src/rent-estimator.ts` (the async queue + LISTEN path), `services/ml`, Postgres, `apps/one/src/lib/rent-trust.ts`.

## Global Constraints

- **Never fabricate a rent number.** A listing with genuinely insufficient inputs must stay unscored and be *labelled* as such — a wrong estimate is far worse than a missing one, because the whole product is a trust instrument. This mirrors the existing "implausible rents are demoted, not hidden" rule.
- **Use the existing queue.** Backfills flow through `rent_calc_status` and the rent-estimator worker, not an out-of-band script that bypasses its pacing, retry, and audit trail.
- **Respect the load budget.** A 44k backfill must be batched and rate-limited so it does not become the new top consumer; verify against `db-load-budget.sh` while it runs.
- **The ML service is a dependency, not a given** — if failures are caused by the model service (timeouts, OOM, bad inputs), fix or bound that rather than retrying into the same wall.
- **Bands must be honest**: a confidence interval that is really "±X% of the point estimate" is not a confidence interval. Either derive it from real comp dispersion or do not claim it.
- **No user-visible number may change meaning** without the trust classifier agreeing — `assessRent`'s verdicts are the contract.
- **Tests:** `pnpm --filter @oper/worker test`, `pnpm --filter @oper/one test`.

## Current State (measured 2026-07-27 on prod, `listing_status='active'`)

| Metric | Count | Share of active |
|---|---|---|
| Active listings | 447,927 | — |
| **No rent estimate** | **44,564** | **10%** |
| **No confidence band** (`rent_low`/`rent_high` null) | **306,413** | **68%** |
| `rent_calc_status='done'` | 443,086 | 99% |
| `rent_calc_status='failed'` | 4,838 | 1% |

Note the tension in those rows: 443k are marked `done` yet 44.5k have no estimate — **"done" does not mean "estimated"**, which is itself a finding: the status column is not a reliable coverage signal today.

- Rent model v2 shipped with MAE ≈ $290 (high-variance segment ≈ $592) — the model works; this is a pipeline-completeness problem, not a modelling one.
- The trust classifier (`assessRent`, `apps/one/src/lib/rent-trust.ts`) already grades estimates `trusted | wide | implausible` using HUD FMR and comps; ~9.6k listings are excluded from trusted feeds as implausible.
- The rent estimator is async: `LISTEN rent_job_enqueued` + a drain loop, on `DATABASE_URL_DIRECT`.
- The deal page renders a p10–p90 band when present and a bare point estimate otherwise — the 68% path.

## File Structure

| File | Responsibility |
|---|---|
| `docs/perf/2026-07-rent-coverage-audit.md` (create) | Task 1's measured breakdown of *why* each gap exists. |
| `apps/worker/src/rent-estimator.ts` (modify) | Enqueue gaps; classify failures; record band inputs. |
| `infrastructure/migrations/2026_07_28_rent_calc_diagnostics.sql` (create) | Failure-reason column + index for triage. |
| `apps/one/src/lib/rent-trust.ts` (modify, if warranted) | Treat "no band" explicitly rather than implicitly. |
| `apps/one/src/app/property/[id]/page.tsx` (modify) | Honest presentation for unscored/unbanded listings. |

---

## Task 1: Audit — why is each gap there?

- [ ] **Step 1:** For the 44,564 unscored active listings, break down by cause with SQL: missing `sqft`/`beds`/`property_type`, non-rentable type, never enqueued (`rent_calc_status` never set), enqueued-but-stuck, or `failed`. Produce counts per bucket — **no fixes yet**.
- [ ] **Step 2:** Explain the `done`-but-null contradiction (443k done vs 44.5k missing): is `done` set on failure paths, on skip paths, or overwritten by a later crawl? This determines whether `rent_calc_status` can be trusted as a coverage signal at all.
- [ ] **Step 3:** For the 4,838 failures, sample 50 and classify by actual error (ML timeout, missing input, bad geo, exception). Record the top 5 causes with counts.
- [ ] **Step 4:** For bands: compare 100 listings *with* a band against 100 without — what input distinguishes them (comp count? geography? model path?).
- [ ] **Step 5:** Write `docs/perf/2026-07-rent-coverage-audit.md` with the numbers and the diagnosis. Commit — `docs(rent): coverage audit — why 10% is unscored and 68% unbanded`

## Task 2: Make status honest + failures triageable

- [ ] **Step 1: Migration** — add `rent_calc_error text` (nullable) and an index on `(rent_calc_status, listing_status)` for triage queries.
- [ ] **Step 2: Failing tests** — the estimator writes a specific `rent_calc_error` on each failure class; a listing that is genuinely un-estimatable (missing required inputs) is marked with a distinct terminal status rather than `done`; `done` implies a non-null `estimated_rent` (assert this invariant in a test).
- [ ] **Step 3: RED → implement** in `rent-estimator.ts`. Backfill the corrected status for existing rows in batches.
- [ ] **Step 4:** Commit — `fix(rent): 'done' now implies an estimate; failures record a reason`

## Task 3: Close the coverage gap

- [ ] **Step 1:** Enqueue the recoverable buckets from Task 1 through the **existing** queue, rate-limited (batch size + interval as env), with progress logging.
- [ ] **Step 2:** Watch `db-load-budget.sh` and the crawl SLOs during the backfill — it must not starve the crawler or trip the budget. Pause/resume must work.
- [ ] **Step 3: Verify** unscored active listings drop toward the irreducible floor (genuinely un-estimatable rows), and that number is *explainable* — state it in the audit doc.
- [ ] **Step 4:** Commit — `feat(rent): backfill unscored active inventory through the estimator queue`

## Task 4: Confidence bands where they are real

- [ ] **Step 1:** Based on Task 1 Step 4, extend the band-producing path to the listings that have sufficient comp support. **Do not** synthesize a band from the point estimate alone.
- [ ] **Step 2:** For listings that still cannot support a band, make the UI say so plainly (the deal page already has an honest point-estimate state from the trust work) and ensure `assessRent` treats band-absence as a first-class input rather than a silent default.
- [ ] **Step 3: Verify** the banded share rises materially and that `assessRent` verdicts stay stable for a sample of listings that had bands before (no verdict should flip because of this change alone).
- [ ] **Step 4:** Commit — `feat(rent): real confidence bands wherever comp support allows`

## Task 5: Deploy + product proof

- [ ] **Step 1:** Deploy worker + app; run the backfill to completion; record before/after for all four metrics in the table above.
- [ ] **Step 2: Product proof** — the homepage `total`/`onePercentPasses` rise consistently with the new coverage (more scored inventory = more deals discoverable), and `stats_summary` reflects it after a refresh.
- [ ] **Step 3: Trust proof** — the implausible share does **not** balloon: newly-scored listings must pass `assessRent` at a similar rate, or the backfill has introduced junk. This is the guard against trading coverage for accuracy.
- [ ] **Step 4:** Update `docs/HANDOFF.md` §10 and the audit doc with final numbers. Commit — `docs(rent): coverage/confidence before/after`

## Self-Review

**Spec coverage:** the 10% invisible inventory is diagnosed then closed through the real queue (T1, T3) · 4,838 silent failures become classified and actionable (T1, T2) · the `done`-but-null contradiction — a broken coverage signal — is fixed rather than worked around (T2) · bands are extended only where genuinely supported, never synthesized (T4) · and the whole thing is guarded against trading trust for coverage (T5 Step 3). Covered.

**Placeholder scan:** Task 1 is deliberately audit-only with concrete bucket definitions, because the *causes* are unknown and guessing them would produce the wrong fix — the same mistake the market-page plan made before measurement corrected it. Every later task states what it changes and how it is verified.

**Type consistency:** `rent_calc_error` + the corrected `rent_calc_status` semantics are the new contract, written by the estimator and read by triage queries; `assessRent`'s existing `trusted | wide | implausible` verdicts remain the single interface the UI consumes.
