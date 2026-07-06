# Wave 3 — Underwriting Truth: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** Underwriting math uses real costs where we have them — actual tax records, actual HOA, live FRED mortgage rate, state-level insurance — with per-input provenance ("from records" vs "estimated") visible on the scorecard. One truth stays in `@oper/primitives/underwriting.ts`.

**Architecture:** A small `mortgage_rates` table + fetcher keeps the FRED 30-yr rate fresh (route `/api/mortgage-rates` already exists — repoint underwriting config at stored rate). `RuleConfig`/metric functions gain optional real-cost inputs with an accompanying `provenance` record; the 50%-rule NOI convention REMAINS the rule-evaluation truth (spec'd convention), while the itemized calculator path (`calculators.ts` + Financials/Overview tabs) consumes real tax/HOA/insurance. Scorecard + Overview render provenance chips.

**Spec:** Wave 3 section. **Depends on:** Wave 1 (tax/hoa columns populated), Wave 2 optional but preferred (rent bands for display). **HARD GATE: working FRED key** (owner rotation — `documentation/operations/wave-0-secrets-rotation.md` #2). Task 0 verifies; if the key is dead, STOP after Task 0 and surface.

## Global Constraints
- Wave 0 rules. One-truth rule: every new financial formula lives in `packages/primitives` (or SQL mirrored by the parity test) — no app-local math.
- Fractions not percentages (existing convention, underwriting.ts:10).
- Branch `wave/3-underwriting-truth`.

### Task 0: FRED gate check
- [ ] `curl -s http://localhost:3001/api/mortgage-rates` on prod. Real rates JSON → proceed. Error/placeholder → **STOP, report to owner** (spec gate; do not ship hardcoded-rate "truth").

### Task 1: Live rate storage + config wiring
**Files:** migration `2026_07_06_mortgage_rates.sql` (table: `observed_on DATE PK, rate_30yr NUMERIC, source TEXT`); modify `apps/one/src/app/api/mortgage-rates/route.ts` to upsert on fetch; a tiny fetch-on-read server helper `getCurrentRate()` (Redis 12h cache, falls back to latest stored row, then to `DEFAULT_RATE` with provenance='fallback').
- [ ] Wire `getCurrentRate()` into wherever `interestRate` enters RuleConfig construction (grep `interestRate` in apps/one server actions/api — update the construction sites, not the primitive).
- [ ] Acceptance: scorecard debt-service shifts when the stored rate differs from the old hardcoded value; provenance notes rate source + observed_on.

### Task 2: Real tax + HOA into the metric layer
**Files:** modify `packages/primitives/src/underwriting.ts` + `calculators.ts`; modify data plumbing (`actions.ts` getProperty/getProperties SELECTs add `tax_annual_amount, hoa_fee, assessed_value, estimated_value`).
- [ ] `underwriting.ts`: add `RealCosts { taxAnnual?: number|null; hoaMonthly?: number|null; insuranceAnnual?: number|null }` + `CostProvenance { tax: 'records'|'estimated'; hoa: 'records'|'assumed_zero'; insurance: 'state_table'|'flat_default'; rate: 'fred'|'stored'|'fallback' }`. New helper `resolveCosts(listing, cfg, stateInsuranceRow) → {costs, provenance}`: tax = real if present else `assessed_value × county_millage_rate / 1000` (Wave 1 spec — uses stored assessed_value and county millage rate; see Wave 1 findings doc); hoa = column value else 0; insurance from Task 3 table else current flat.
- [ ] Rule-evaluation NOI stays 50%-rule (unchanged, documented). `calculators.ts` itemized path consumes resolved costs. Overview cap-rate card (already labeled itemized) now uses real tax where present.
- [ ] Parity test (`underwriting.test.ts`) extended: resolveCosts branches (real vs estimated), fraction discipline.
- [ ] Acceptance: typecheck + tests; a listing with real tax shows different (correct) itemized cap-rate than before, provenance says 'records'.

### Task 3: State insurance table
**Files:** migration `2026_07_06_insurance_state_avg.sql` — static seed `insurance_state_avg(state TEXT PK, annual_avg NUMERIC, pct_of_value NUMERIC, source TEXT, as_of DATE)`, values from a citable public dataset (NAIC/Insurance.com state averages — verify actual numbers via WebSearch at execution; embed source URL in the migration comment).
- [ ] `resolveCosts` consumes it via plumbed `stateInsuranceRow`.
- [ ] Acceptance: FL listing carries visibly higher insurance than OH listing in the itemized view.

### Task 4: Flip ARV
**Files:** `underwriting.ts` (flip section — read exact current flip inputs at execution); `actions.ts`.
- [ ] `arv = estimated_value` (Wave 1 col, ~80% coverage) else comps P75 $/sqft × sqft (comps endpoint exists) else null → flip stays `gradable:false` (existing insufficient-data path).
- [ ] Provenance chip: "ARV from estimate" / "ARV from comps".
- [ ] Acceptance: flip-strategy scorecard grades where estimated_value exists; provisional/insufficient elsewhere.

### Task 5: Provenance UI
**Files:** `PropertyScorecardTab.tsx`, `PropertyOverviewTab.tsx`/`PropertyFinancialsTab.tsx` (read at execution for exact insertion points).
- [ ] Chips: "tax: county records" (emerald) vs "tax: estimated" (muted); same for rate/insurance/ARV. Compact row under the grade header.
- [ ] Acceptance: screenshot on prod detail page; chips render both states.

### Task 6: Deploy + acceptance
- [ ] Full: typecheck/tests/build → deploy app → prod screenshots → parity test green → memory update.
- Exit: cap-rate/cash-flow shift on tax-real listings; provenance visible; FRED rate live with staleness guard; no app-local math introduced.
