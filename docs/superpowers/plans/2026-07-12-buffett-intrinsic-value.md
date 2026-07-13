# Intrinsic Value & Margin of Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**The Buffett voice:** *"Price is what you pay; value is what you get. Your whole product tells me the price and one crude ratio — it never tells me what the thing is actually worth, or how much cushion I have if I'm wrong. Give me an intrinsic value from the cash it throws off, a margin of safety against the asking price, and an honest ten-year owner's return. And notice — the data that lets you compute that (your rent model, the assessor rolls, the price history) is your moat. Charge for the deep version. That's a business."*

**Goal:** Compute and display, per property, an **intrinsic value** (income-approach valuation from the property's own cash flow), a **margin of safety** vs the asking price, and a **ten-year owner-return projection** — a free headline for everyone and a full, assumption-transparent breakdown gated to the Pro tier, monetizing the proprietary data moat (rent model + assessor + HPI + rules).

**Architecture:** All valuation math lives as **pure functions** in a new `@oper/primitives/intrinsic` module (fully unit-testable, no I/O). A server assembler (`apps/one/src/lib/valuation.ts`) gathers the per-property inputs (rent estimate, assessed value, metro cap-rate proxy, HPI trend, opex from `property_type_rules`, insurance) via `pool` and feeds the pure functions. The property page renders a free `IntrinsicValueCard` (value + margin-of-safety badge) and a Pro-gated `OwnerReturnBreakdown` (10-year projection chart + editable assumptions).

**Tech Stack:** `@oper/primitives` (TS, Vitest), Postgres (`fhfa_zip_hpi`, `property_type_rules`, `insurance_state_avg`, `listings` tax-assessed columns), Next 16 apps/one, existing tier gate (`useSessionUser` / server tier checks), eggshell design tokens.

## Global Constraints

- **All money math is pure and tested.** No valuation arithmetic in a React component or a route handler — it goes in `@oper/primitives/intrinsic` with tests. (Mirrors the existing `underwriting`/`grading` split in `@oper/primitives`.)
- **Ratios/rates are fractions in the domain layer**, percents only at render (consistent with `calculatePropertyMetrics`).
- **Every displayed number carries provenance.** Each output states its inputs/assumptions (use the `.prov` class). No black-box valuations — Buffett doesn't buy what he can't explain.
- **Per-property-type parameters come from `property_type_rules`**, never hardcoded (opex ratio, target ratio, down payment). Fall back to documented defaults only when a rule row is absent.
- **Pro gating is server-side.** The free response includes the headline value + margin of safety; the full projection + assumption breakdown require `tier === 'pro'` (reuse the compare/terminal 402/upsell pattern).
- **Never touch `listings.updated_at`.** Read-only.
- **Tests:** Vitest, `pnpm --filter @oper/primitives test <path>` and `pnpm --filter @oper/one test <path>`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/primitives/src/intrinsic.ts` (create) | Pure valuation math: `intrinsicValue`, `marginOfSafety`, `ownerReturn10yr`. |
| `packages/primitives/src/intrinsic.test.ts` (create) | Unit tests for the math (worked numeric examples). |
| `packages/primitives/src/index.ts` (modify) | Re-export the intrinsic API. |
| `apps/one/src/lib/valuation.ts` (create) | Server assembler: gather per-property inputs → call the pure fns → `Valuation`. |
| `apps/one/src/app/api/valuation/[id]/route.ts` (create) | GET per-property valuation; free = headline, pro = full. |
| `apps/one/src/components/property/IntrinsicValueCard.tsx` (create) | Free headline: intrinsic value + margin-of-safety badge + one-line provenance. |
| `apps/one/src/components/property/OwnerReturnBreakdown.tsx` (create) | Pro: 10-year projection table/sparkline + assumptions, or upsell. |
| `apps/one/src/app/property/[id]/page.tsx` (modify) | Mount the two components in the verdict rail. |

---

## Task 1: `intrinsicValue` + `marginOfSafety` (pure)

**Files:**
- Create: `packages/primitives/src/intrinsic.ts`
- Test: `packages/primitives/src/intrinsic.test.ts`

**Interfaces:**
- Produces:
  - `type IntrinsicInput = { monthlyRent: number; opexRatio: number; marketCapRate: number }`
  - `intrinsicValue(i: IntrinsicInput): number` — income approach: `NOI / capRate`, `NOI = monthlyRent*12*(1-opexRatio)`.
  - `marginOfSafety(intrinsic: number, price: number): number` — `(intrinsic - price) / intrinsic` (fraction; positive = cushion).

- [ ] **Step 1: Write the failing test**

```ts
// packages/primitives/src/intrinsic.test.ts
import { describe, it, expect } from 'vitest';
import { intrinsicValue, marginOfSafety } from './intrinsic';

describe('intrinsicValue (income approach)', () => {
  it('values a property at NOI / cap rate', () => {
    // rent 2000/mo → 24000/yr; opex 45% → NOI 13200; cap 6.6% → ~200000
    expect(intrinsicValue({ monthlyRent: 2000, opexRatio: 0.45, marketCapRate: 0.066 }))
      .toBeCloseTo(200000, -2); // within ~100
  });
  it('returns 0 for a non-positive cap rate (avoid divide-by-zero blowups)', () => {
    expect(intrinsicValue({ monthlyRent: 2000, opexRatio: 0.45, marketCapRate: 0 })).toBe(0);
  });
});

describe('marginOfSafety', () => {
  it('is positive when intrinsic exceeds price', () => {
    expect(marginOfSafety(200000, 160000)).toBeCloseTo(0.2, 5);
  });
  it('is negative (overpaying) when price exceeds intrinsic', () => {
    expect(marginOfSafety(200000, 240000)).toBeCloseTo(-0.2, 5);
  });
  it('returns 0 when intrinsic is 0', () => {
    expect(marginOfSafety(0, 160000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/primitives test src/intrinsic.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/primitives/src/intrinsic.ts

export type IntrinsicInput = {
  monthlyRent: number;   // estimated monthly rent (dollars)
  opexRatio: number;     // operating-expense fraction of gross rent (from property_type_rules)
  marketCapRate: number; // market capitalization rate (fraction), metro-derived
};

/**
 * Income-approach intrinsic value: the price at which the property's own net
 * operating income yields the market cap rate. NOI = annual gross rent net of
 * operating expenses; value = NOI / capRate. Financing-agnostic by design
 * (Buffett values the asset, not the loan).
 */
export function intrinsicValue({ monthlyRent, opexRatio, marketCapRate }: IntrinsicInput): number {
  if (!(marketCapRate > 0) || !(monthlyRent > 0)) return 0;
  const noi = monthlyRent * 12 * (1 - opexRatio);
  return noi / marketCapRate;
}

/** Cushion between value and price, as a fraction of value. Positive = discount. */
export function marginOfSafety(intrinsic: number, price: number): number {
  if (!(intrinsic > 0)) return 0;
  return (intrinsic - price) / intrinsic;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/primitives test src/intrinsic.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/primitives/src/intrinsic.ts packages/primitives/src/intrinsic.test.ts
git commit -m "feat(primitives): intrinsicValue + marginOfSafety (income approach)"
```

---

## Task 2: `ownerReturn10yr` (pure 10-year projection)

**Files:**
- Modify: `packages/primitives/src/intrinsic.ts`
- Modify: `packages/primitives/src/intrinsic.test.ts`

**Interfaces:**
- Produces:
  - `type OwnerReturnInput = { price: number; downPct: number; monthlyRent: number; opexRatio: number; appreciationRate: number; rentGrowthRate: number; mortgageRate: number }`
  - `type OwnerReturnYear = { year: number; equity: number; cumCashFlow: number; propertyValue: number }`
  - `type OwnerReturn = { years: OwnerReturnYear[]; equityMultiple: number; avgAnnualCashOnCash: number }`
  - `ownerReturn10yr(i: OwnerReturnInput): OwnerReturn` — 30-yr amortization, annual compounding of value + rent, cash flow = NOI − debt service.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/primitives/src/intrinsic.test.ts
import { ownerReturn10yr } from './intrinsic';

describe('ownerReturn10yr', () => {
  const base = {
    price: 200000, downPct: 0.2, monthlyRent: 2000, opexRatio: 0.45,
    appreciationRate: 0.03, rentGrowthRate: 0.03, mortgageRate: 0.07,
  };
  it('produces 10 yearly rows with growing property value', () => {
    const r = ownerReturn10yr(base);
    expect(r.years).toHaveLength(10);
    expect(r.years[9].propertyValue).toBeGreaterThan(base.price);
    // 200k appreciating 3%/yr for 10y ≈ 268.8k
    expect(r.years[9].propertyValue).toBeCloseTo(268783, -2);
  });
  it('equity in year 10 exceeds the initial down payment (amortization + appreciation)', () => {
    const r = ownerReturn10yr(base);
    expect(r.years[9].equity).toBeGreaterThan(base.price * base.downPct);
  });
  it('reports an equity multiple > 1 for a sane deal', () => {
    expect(ownerReturn10yr(base).equityMultiple).toBeGreaterThan(1);
  });
  it('handles all-cash (downPct = 1, no debt service)', () => {
    const r = ownerReturn10yr({ ...base, downPct: 1 });
    expect(r.years[0].cumCashFlow).toBeGreaterThan(0); // no mortgage → positive year 1
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/primitives test src/intrinsic.test.ts`
Expected: FAIL — `ownerReturn10yr` not exported.

- [ ] **Step 3: Implement** (append to `intrinsic.ts`)

```ts
export type OwnerReturnInput = {
  price: number;
  downPct: number;         // fraction down (e.g. 0.2)
  monthlyRent: number;
  opexRatio: number;
  appreciationRate: number; // annual, fraction (HPI-derived)
  rentGrowthRate: number;   // annual, fraction
  mortgageRate: number;     // annual, fraction
};
export type OwnerReturnYear = { year: number; equity: number; cumCashFlow: number; propertyValue: number };
export type OwnerReturn = { years: OwnerReturnYear[]; equityMultiple: number; avgAnnualCashOnCash: number };

// Standard fixed-rate amortization over 30 years, monthly compounding.
function monthlyPayment(principal: number, annualRate: number, years = 30): number {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
function remainingBalance(principal: number, annualRate: number, monthsPaid: number, years = 30): number {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return Math.max(0, principal * (1 - monthsPaid / n));
  const pmt = monthlyPayment(principal, annualRate, years);
  const bal = principal * Math.pow(1 + r, monthsPaid) - pmt * ((Math.pow(1 + r, monthsPaid) - 1) / r);
  return Math.max(0, bal);
}

/**
 * Ten-year owner return. Value and rent compound annually; cash flow each year
 * is NOI minus debt service; equity is property value minus loan balance.
 * equityMultiple = (final equity + cumulative cash flow) / cash invested.
 */
export function ownerReturn10yr(i: OwnerReturnInput): OwnerReturn {
  const loan = i.price * (1 - i.downPct);
  const cashInvested = i.price * i.downPct;
  const annualDebtService = monthlyPayment(loan, i.mortgageRate) * 12;

  const years: OwnerReturnYear[] = [];
  let cumCashFlow = 0;
  for (let y = 1; y <= 10; y++) {
    const rent = i.monthlyRent * 12 * Math.pow(1 + i.rentGrowthRate, y - 1);
    const noi = rent * (1 - i.opexRatio);
    const cashFlow = noi - annualDebtService;
    cumCashFlow += cashFlow;
    const propertyValue = i.price * Math.pow(1 + i.appreciationRate, y);
    const balance = remainingBalance(loan, i.mortgageRate, y * 12);
    const equity = propertyValue - balance;
    years.push({ year: y, equity, cumCashFlow, propertyValue });
  }
  const finalEquity = years[9].equity;
  const equityMultiple = cashInvested > 0 ? (finalEquity + cumCashFlow) / cashInvested : 0;
  const avgAnnualCashOnCash = cashInvested > 0 ? cumCashFlow / 10 / cashInvested : 0;
  return { years, equityMultiple, avgAnnualCashOnCash };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/primitives test src/intrinsic.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Export from the package index**

In `packages/primitives/src/index.ts`, add:

```ts
export * from './intrinsic';
```

Then: `pnpm --filter @oper/primitives typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/primitives/src/intrinsic.ts packages/primitives/src/intrinsic.test.ts packages/primitives/src/index.ts
git commit -m "feat(primitives): ownerReturn10yr projection + export intrinsic API"
```

---

## Task 3: Server assembler `valuation.ts`

**Files:**
- Create: `apps/one/src/lib/valuation.ts`
- Test: `apps/one/src/lib/valuation.test.ts`

**Interfaces:**
- Consumes: `intrinsicValue`, `marginOfSafety`, `ownerReturn10yr` from `@oper/primitives`; `pool` from `apps/one/src/lib/db.ts`.
- Produces:
  - `type ValuationInputs = { price: number; monthlyRent: number; opexRatio: number; marketCapRate: number; appreciationRate: number; rentGrowthRate: number; mortgageRate: number; downPct: number; provenance: string[] }`
  - `assembleInputs(row): ValuationInputs` — **pure** mapping from a joined DB row to inputs, applying documented defaults + recording provenance strings.
  - `type Valuation = { intrinsic: number; marginOfSafety: number; ownerReturn: import('@oper/primitives').OwnerReturn; inputs: ValuationInputs }`
  - `computeValuation(row): Valuation` — pure; composes assembler + primitives.

- [ ] **Step 1: Write the failing test** (pure `assembleInputs`/`computeValuation`; DB left to Task 4 smoke)

```ts
// apps/one/src/lib/valuation.test.ts
import { describe, it, expect } from 'vitest';
import { assembleInputs, computeValuation } from './valuation';

const row = {
  listing_price: '200000', estimated_rent: '2000',
  opex_ratio: '0.45', down_payment_pct: '0.2',   // from property_type_rules
  hpi_cagr_5yr: '0.04',                            // from fhfa_zip_hpi (Task 4 derives)
  metro_cap_rate: '0.066',                         // Task 4 derives
};

describe('assembleInputs', () => {
  it('maps DB fields to typed inputs and records provenance', () => {
    const i = assembleInputs(row);
    expect(i.price).toBe(200000);
    expect(i.opexRatio).toBeCloseTo(0.45, 5);
    expect(i.marketCapRate).toBeCloseTo(0.066, 5);
    expect(i.provenance.join(' ')).toMatch(/property_type_rules/);
  });
  it('falls back to documented defaults when rule fields are null, noting it', () => {
    const i = assembleInputs({ ...row, opex_ratio: null, down_payment_pct: null, metro_cap_rate: null });
    expect(i.opexRatio).toBe(0.45);   // default
    expect(i.downPct).toBe(0.2);      // default
    expect(i.marketCapRate).toBe(0.07); // default
    expect(i.provenance.join(' ')).toMatch(/default/i);
  });
});

describe('computeValuation', () => {
  it('produces intrinsic, margin of safety, and a 10-year projection', () => {
    const v = computeValuation(row);
    expect(v.intrinsic).toBeGreaterThan(0);
    expect(v.ownerReturn.years).toHaveLength(10);
    expect(typeof v.marginOfSafety).toBe('number');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/lib/valuation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (assembler + composer are pure; the DB fetch is a separate exported async fn used by the route)

```ts
// apps/one/src/lib/valuation.ts
import { intrinsicValue, marginOfSafety, ownerReturn10yr, type OwnerReturn } from '@oper/primitives';
import pool from '@/lib/db';

// Documented defaults when a property_type_rules row or metro stat is absent.
const DEFAULT_OPEX = 0.45;       // 50% rule, softened
const DEFAULT_DOWN = 0.2;
const DEFAULT_CAP = 0.07;
const DEFAULT_APPRECIATION = 0.03;
const DEFAULT_RENT_GROWTH = 0.03;
const DEFAULT_MORTGAGE = 0.07;

export type ValuationInputs = {
  price: number; monthlyRent: number; opexRatio: number; marketCapRate: number;
  appreciationRate: number; rentGrowthRate: number; mortgageRate: number; downPct: number;
  provenance: string[];
};
export type Valuation = { intrinsic: number; marginOfSafety: number; ownerReturn: OwnerReturn; inputs: ValuationInputs };

function num(v: unknown, fallback: number): { value: number; wasDefault: boolean } {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? { value: n, wasDefault: false } : { value: fallback, wasDefault: true };
}

export function assembleInputs(row: Record<string, unknown>): ValuationInputs {
  const provenance: string[] = [];
  const price = Number(row.listing_price) || 0;
  const monthlyRent = Number(row.estimated_rent) || 0;

  const opex = num(row.opex_ratio, DEFAULT_OPEX);
  provenance.push(opex.wasDefault ? 'opex: 45% default' : 'opex: property_type_rules');
  const down = num(row.down_payment_pct, DEFAULT_DOWN);
  provenance.push(down.wasDefault ? 'down: 20% default' : 'down: property_type_rules');
  const cap = num(row.metro_cap_rate, DEFAULT_CAP);
  provenance.push(cap.wasDefault ? 'cap rate: 7% default' : 'cap rate: metro median');
  const appr = num(row.hpi_cagr_5yr, DEFAULT_APPRECIATION);
  provenance.push(appr.wasDefault ? 'appreciation: 3% default' : 'appreciation: FHFA HPI 5yr CAGR');

  return {
    price, monthlyRent,
    opexRatio: opex.value, downPct: down.value, marketCapRate: cap.value,
    appreciationRate: appr.value, rentGrowthRate: DEFAULT_RENT_GROWTH, mortgageRate: DEFAULT_MORTGAGE,
    provenance,
  };
}

export function computeValuation(row: Record<string, unknown>): Valuation {
  const inputs = assembleInputs(row);
  const intrinsic = intrinsicValue({
    monthlyRent: inputs.monthlyRent, opexRatio: inputs.opexRatio, marketCapRate: inputs.marketCapRate,
  });
  return {
    intrinsic,
    marginOfSafety: marginOfSafety(intrinsic, inputs.price),
    ownerReturn: ownerReturn10yr({
      price: inputs.price, downPct: inputs.downPct, monthlyRent: inputs.monthlyRent,
      opexRatio: inputs.opexRatio, appreciationRate: inputs.appreciationRate,
      rentGrowthRate: inputs.rentGrowthRate, mortgageRate: inputs.mortgageRate,
    }),
    inputs,
  };
}

/**
 * Fetch the joined valuation row for a listing. Derives the metro cap-rate proxy
 * (median rent*12*(1-0.45) / price over the ZIP's rentable stock) and the FHFA
 * 5-year HPI CAGR for the ZIP, plus the property_type_rules opex/down.
 */
export async function fetchValuationRow(id: string): Promise<Record<string, unknown> | null> {
  const res = await pool.query(
    `WITH l AS (
        SELECT id, listing_price, estimated_rent, property_type, zip_code
        FROM listings WHERE id = $1
     ),
     r AS (
        SELECT operating_expense_ratio AS opex_ratio, down_payment_pct
        FROM property_type_rules pr JOIN l ON pr.property_type = l.property_type
     ),
     cap AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (estimated_rent*12*0.55) / NULLIF(listing_price,0)
               ) AS metro_cap_rate
        FROM listings x JOIN l ON x.zip_code = l.zip_code
        WHERE x.listing_price > 0 AND x.estimated_rent > 0
     ),
     hpi AS (
        SELECT power(
                 NULLIF(max(hpi) FILTER (WHERE year = (SELECT max(year) FROM fhfa_zip_hpi h2 WHERE h2.zip5 = l.zip_code)),0)
                 / NULLIF(max(hpi) FILTER (WHERE year = (SELECT max(year)-5 FROM fhfa_zip_hpi h3 WHERE h3.zip5 = l.zip_code)),0),
                 1.0/5) - 1 AS hpi_cagr_5yr
        FROM fhfa_zip_hpi f JOIN l ON f.zip5 = l.zip_code
     )
     SELECT l.listing_price, l.estimated_rent, r.opex_ratio, r.down_payment_pct,
            cap.metro_cap_rate, hpi.hpi_cagr_5yr
     FROM l LEFT JOIN r ON true LEFT JOIN cap ON true LEFT JOIN hpi ON true`,
    [id],
  );
  return res.rows[0] ?? null;
}
```

> **Column-name check before implementing:** confirm the real column names in `property_type_rules` (the plan assumes `operating_expense_ratio`, `down_payment_pct`) and `fhfa_zip_hpi` (`zip5`, `year`, `hpi`) with `\d property_type_rules` and `\d fhfa_zip_hpi`. Adjust the SQL to the actual names; keep `assembleInputs`'s field keys (`opex_ratio`, `down_payment_pct`, `metro_cap_rate`, `hpi_cagr_5yr`) as the stable interface so the pure code and tests don't change.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/lib/valuation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/lib/valuation.ts apps/one/src/lib/valuation.test.ts
git commit -m "feat(valuation): assemble per-property inputs + compute intrinsic/MoS/10yr"
```

---

## Task 4: `/api/valuation/[id]` (free headline vs pro full)

**Files:**
- Create: `apps/one/src/app/api/valuation/[id]/route.ts`
- Test: `apps/one/src/app/api/valuation/[id]/route.test.ts`

**Interfaces:**
- Consumes: `fetchValuationRow`, `computeValuation` (Task 3); `getSessionUser` from `apps/one/src/lib/auth.ts`.
- Produces: `GET(req, {params})` → for all users `{ intrinsic, marginOfSafety, headline }`; for `tier==='pro'` also `{ ownerReturn, inputs }`. Exported `shapeResponse(valuation, isPro)` (pure) for testing.

- [ ] **Step 1: Write the failing test**

```ts
// apps/one/src/app/api/valuation/[id]/route.test.ts
import { describe, it, expect } from 'vitest';
import { shapeResponse } from './route';
import { computeValuation } from '@/lib/valuation';

const v = computeValuation({
  listing_price: '200000', estimated_rent: '2000', opex_ratio: '0.45',
  down_payment_pct: '0.2', metro_cap_rate: '0.066', hpi_cagr_5yr: '0.04',
});

describe('shapeResponse', () => {
  it('free tier gets headline + margin of safety but NOT the full projection', () => {
    const r = shapeResponse(v, false) as Record<string, unknown>;
    expect(r.intrinsic).toBeGreaterThan(0);
    expect(r.marginOfSafety).toBeDefined();
    expect(r.ownerReturn).toBeUndefined();
    expect(r.inputs).toBeUndefined();
  });
  it('pro tier gets the full projection + inputs', () => {
    const r = shapeResponse(v, true) as Record<string, unknown>;
    expect(r.ownerReturn).toBeDefined();
    expect(r.inputs).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test 'src/app/api/valuation/[id]/route.test.ts'`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/one/src/app/api/valuation/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchValuationRow, computeValuation, type Valuation } from '@/lib/valuation';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function shapeResponse(v: Valuation, isPro: boolean) {
  const base = {
    intrinsic: Math.round(v.intrinsic),
    marginOfSafety: v.marginOfSafety,
    headline:
      v.marginOfSafety >= 0
        ? `${(v.marginOfSafety * 100).toFixed(0)}% below intrinsic value`
        : `${(Math.abs(v.marginOfSafety) * 100).toFixed(0)}% above intrinsic value`,
  };
  if (!isPro) return base;
  return { ...base, ownerReturn: v.ownerReturn, inputs: v.inputs };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  try {
    const row = await fetchValuationRow(id);
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const isPro = (await getSessionUser())?.tier === 'pro';
    return NextResponse.json(shapeResponse(computeValuation(row), isPro));
  } catch (err) {
    console.error('/api/valuation error:', err);
    return NextResponse.json({ error: 'valuation failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test 'src/app/api/valuation/[id]/route.test.ts'`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual DB smoke**

Pick a real listing id (`SELECT id FROM listings WHERE estimated_rent>0 AND listing_price>0 LIMIT 1;`). Run:
`curl -s http://localhost:3000/api/valuation/<id> | head -c 400`
Expected: JSON with `intrinsic > 0`, a `headline` string, and NO `ownerReturn` (anonymous = not pro).

- [ ] **Step 6: Commit**

```bash
git add 'apps/one/src/app/api/valuation/[id]/route.ts' 'apps/one/src/app/api/valuation/[id]/route.test.ts'
git commit -m "feat(valuation): /api/valuation/[id] — free headline, pro full projection"
```

---

## Task 5: `IntrinsicValueCard` (free headline)

**Files:**
- Create: `apps/one/src/components/property/IntrinsicValueCard.tsx`
- Test: `apps/one/src/components/property/IntrinsicValueCard.test.tsx`

**Interfaces:**
- Produces: `<IntrinsicValueCard listingId={string} />` — fetches `/api/valuation/<id>`, renders intrinsic value + a margin-of-safety badge (green when `>=0`, brass when `<0`) + a one-line provenance note.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/one/src/components/property/IntrinsicValueCard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { IntrinsicValueCard } from './IntrinsicValueCard';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, json: async () => ({ intrinsic: 232000, marginOfSafety: 0.14, headline: '14% below intrinsic value' }),
  }) as Response));
});

describe('IntrinsicValueCard', () => {
  it('shows the intrinsic value and a positive margin-of-safety badge', async () => {
    render(<IntrinsicValueCard listingId="42" />);
    await waitFor(() => expect(screen.getByText(/\$232,000/)).toBeTruthy());
    expect(screen.getByText(/14% below intrinsic value/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/components/property/IntrinsicValueCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/one/src/components/property/IntrinsicValueCard.tsx
'use client';
import { useEffect, useState } from 'react';

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

type Resp = { intrinsic: number; marginOfSafety: number; headline: string };

export function IntrinsicValueCard({ listingId }: { listingId: string }) {
  const [d, setD] = useState<Resp | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/valuation/${listingId}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setD(j); }).catch(() => {});
    return () => { live = false; };
  }, [listingId]);
  if (!d || !(d.intrinsic > 0)) return null;
  const positive = d.marginOfSafety >= 0;
  return (
    <div className="mat p-5">
      <p className="prov">Intrinsic value · income approach</p>
      <p className="figure mt-1 text-3xl" style={{ color: 'var(--text)' }}>{usd0.format(d.intrinsic)}</p>
      <span
        className="mt-3 inline-block rounded-full px-3 py-1 text-[12px] font-semibold"
        style={{ background: positive ? 'var(--pass)' : 'var(--brass)', color: 'var(--ink)' }}
      >
        {d.headline}
      </span>
      <p className="prov mt-3">Value = net operating income ÷ market cap rate. Not investment advice.</p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/components/property/IntrinsicValueCard.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/one/src/components/property/IntrinsicValueCard.tsx apps/one/src/components/property/IntrinsicValueCard.test.tsx
git commit -m "feat(property): IntrinsicValueCard — value + margin-of-safety headline"
```

---

## Task 6: `OwnerReturnBreakdown` (pro projection or upsell) + mount

**Files:**
- Create: `apps/one/src/components/property/OwnerReturnBreakdown.tsx`
- Test: `apps/one/src/components/property/OwnerReturnBreakdown.test.tsx`
- Modify: `apps/one/src/app/property/[id]/page.tsx` (mount both components in the verdict rail)

**Interfaces:**
- Consumes: the `/api/valuation/<id>` response (Task 4); `useSessionUser`.
- Produces: `<OwnerReturnBreakdown listingId={string} />` — pro users see the 10-year equity-multiple + a per-year table; free users see an upsell linking to `/pricing`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/one/src/components/property/OwnerReturnBreakdown.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OwnerReturnBreakdown } from './OwnerReturnBreakdown';

const years = Array.from({ length: 10 }, (_, k) => ({ year: k + 1, equity: 50000 + k * 5000, cumCashFlow: k * 1000, propertyValue: 200000 * (1.03 ** (k + 1)) }));

function stub(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload }) as Response));
}

describe('OwnerReturnBreakdown', () => {
  it('renders the equity multiple when the API returns a pro payload', async () => {
    stub({ intrinsic: 232000, marginOfSafety: 0.14, headline: 'x', ownerReturn: { years, equityMultiple: 2.4, avgAnnualCashOnCash: 0.06 }, inputs: { provenance: ['cap rate: metro median'] } });
    render(<OwnerReturnBreakdown listingId="42" />);
    await waitFor(() => expect(screen.getByText(/2\.4×/)).toBeTruthy());
  });
  it('renders an upsell when the API omits ownerReturn (free tier)', async () => {
    stub({ intrinsic: 232000, marginOfSafety: 0.14, headline: 'x' });
    render(<OwnerReturnBreakdown listingId="42" />);
    await waitFor(() => expect(screen.getByRole('link', { name: /pro/i })).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oper/one test src/components/property/OwnerReturnBreakdown.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/one/src/components/property/OwnerReturnBreakdown.tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

type OwnerReturn = { years: { year: number; equity: number; cumCashFlow: number; propertyValue: number }[]; equityMultiple: number; avgAnnualCashOnCash: number };
type Resp = { ownerReturn?: OwnerReturn; inputs?: { provenance: string[] } };
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function OwnerReturnBreakdown({ listingId }: { listingId: string }) {
  const [d, setD] = useState<Resp | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/valuation/${listingId}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setD(j); }).catch(() => {});
    return () => { live = false; };
  }, [listingId]);
  if (!d) return null;

  if (!d.ownerReturn) {
    return (
      <div className="mat p-5">
        <p className="prov">Ten-year owner return</p>
        <p className="mt-2 text-[14px]" style={{ color: 'var(--haze)' }}>
          Equity multiple, per-year cash flow, and appreciation modeling are a Pro feature.
        </p>
        <Link href="/pricing" className="mt-3 inline-block rounded-[6px] px-4 py-2 text-[13px] font-semibold" style={{ background: 'var(--brass)', color: 'var(--ink)' }}>
          Unlock with Pro
        </Link>
      </div>
    );
  }

  const or = d.ownerReturn;
  return (
    <div className="mat p-5">
      <p className="prov">Ten-year owner return · {(or.avgAnnualCashOnCash * 100).toFixed(1)}% avg cash-on-cash</p>
      <p className="figure mt-1 text-3xl figure--pass">{or.equityMultiple.toFixed(1)}×</p>
      <p className="prov">equity multiple on cash invested</p>
      <table className="mt-3 w-full text-[12px]" style={{ color: 'var(--text)' }}>
        <thead><tr style={{ color: 'var(--mute)' }}><th className="text-left">Yr</th><th className="text-right">Value</th><th className="text-right">Equity</th><th className="text-right">Cum. cash</th></tr></thead>
        <tbody>
          {or.years.filter((y) => y.year % 2 === 1 || y.year === 10).map((y) => (
            <tr key={y.year}>
              <td>{y.year}</td>
              <td className="text-right tabular-nums">{usd0.format(y.propertyValue)}</td>
              <td className="text-right tabular-nums">{usd0.format(y.equity)}</td>
              <td className="text-right tabular-nums">{usd0.format(y.cumCashFlow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.inputs?.provenance?.length ? <p className="prov mt-3">Assumptions: {d.inputs.provenance.join(' · ')}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oper/one test src/components/property/OwnerReturnBreakdown.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount in the property page**

In `apps/one/src/app/property/[id]/page.tsx`, import both components and render them inside the verdict rail (near `VerdictRailClient`). Add:

```tsx
import { IntrinsicValueCard } from '@/components/property/IntrinsicValueCard';
import { OwnerReturnBreakdown } from '@/components/property/OwnerReturnBreakdown';
```

and, in the rail column JSX (find the `VerdictRailClient` usage and place these directly below it):

```tsx
<IntrinsicValueCard listingId={String(id)} />
<OwnerReturnBreakdown listingId={String(id)} />
```

(`id` is the route param already in scope on that page; use the same variable the page passes to `VerdictRailClient`.)

- [ ] **Step 6: Typecheck + manual**

Run: `pnpm --filter @oper/one typecheck` → PASS.
Manual: open `/property/<id>` signed out → intrinsic card + margin badge show, owner-return shows the upsell. Sign in as a pro test account (Stripe runbook) → owner-return shows the equity multiple + table.

- [ ] **Step 7: Commit**

```bash
git add apps/one/src/components/property/OwnerReturnBreakdown.tsx apps/one/src/components/property/OwnerReturnBreakdown.test.tsx 'apps/one/src/app/property/[id]/page.tsx'
git commit -m "feat(property): OwnerReturnBreakdown (pro) + mount valuation in verdict rail"
```

---

## Self-Review

**Spec coverage:** intrinsic value (Tasks 1, 3, 5) · margin of safety (Tasks 1, 5) · ten-year owner return (Tasks 2, 6) · pure/tested money math in primitives (Tasks 1–2) · per-type params from `property_type_rules` + documented defaults with provenance (Task 3) · moat monetization via server-side pro gate (Tasks 4, 6) · every number carries provenance (Tasks 5–6). Covered.

**Placeholder scan:** all steps carry real code/paths/commands. The one caveat — real column names in `property_type_rules`/`fhfa_zip_hpi` — is called out explicitly with the `\d` check and a stable interface boundary so the tested pure code is unaffected.

**Type consistency:** `IntrinsicInput`, `OwnerReturnInput`, `OwnerReturn` are defined once (Tasks 1–2) and consumed unchanged by `valuation.ts` (Task 3), the route (Task 4), and the components (Tasks 5–6). The API response shape (`{ intrinsic, marginOfSafety, headline, ownerReturn?, inputs? }`) is produced by `shapeResponse` (Task 4) and read identically in Tasks 5–6. `assembleInputs` field keys (`opex_ratio`, `down_payment_pct`, `metro_cap_rate`, `hpi_cagr_5yr`) are the stable seam between SQL and pure code.
