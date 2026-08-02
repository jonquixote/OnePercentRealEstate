# Underwriting Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, on the home page, that we underwrite a property for *every kind of buyer* — not that we have a ratio.

**Architecture:** The differentiation already exists in code and is completely invisible. `packages/primitives/src/underwriting.ts` computes cap rate, DSCR, debt yield, GRM, NOI, cash-on-cash and an A–F grade across four strategies; `intrinsic.ts` computes intrinsic value, margin of safety and a 10-year owner return with equity multiple. **None of it is imported anywhere in `app/page.tsx` or `components/home/`.** The home page shows one number, `rent_price_ratio`, for one buyer. This plan puts the underwriting verdict on the hero deal, adds a buyer-lens switch that changes the verdict rather than just filtering, and makes the reasoning inspectable.

**Tech Stack:** Next 16 RSC, `@oper/primitives` (`evaluateRules`, `ownerReturn10yr`, `intrinsicValue`), PostgreSQL 16, vitest.

## Global Constraints

- **Depends on `2026-08-02-home-server-first.md`.** That plan makes the hero a server component; this one renders underwriting inside it. Do not start until Task 5 of that plan is merged.
- **Never invent an input.** `evaluateRules` already returns `RuleResult` entries that can be unmet for lack of data; surface "not enough data" rather than a fabricated number. This is the codebase's established rule — `rent_calc_status='done'` means an estimate exists, `not_applicable` means the type cannot be rented, and both are shown honestly.
- **Measured data coverage (prod, 2026-08-02) — build only what these support:**
  - `estimated_rent > 0`: **486,295 of 543,751 (89%)** → buy & hold is fully computable
  - `sqft > 0`: **478,016 (88%)** → rehab estimates computable
  - sold comps last 180d: **246,702 across 17,472 ZIPs** → ARV for flip/BRRRR
  - rental comps: **728,367 across 14,770 ZIPs**
  - **`raw_data->>'tax_assessed_value'`: 0 rows. Completely empty — no feature may depend on it.**
- **STR is not shippable yet.** `RuleConfig.strAdr` / `strOccupancy` have no data source in the database. STR must render as "not yet covered", never as a computed number.
- **`rent_price_ratio` is a generated column** with a `price >= 10000` credibility guard (migration `2026_08_02`). Never recompute rent/price in application code — read the column.
- **Do not add a client-side underwriting bundle.** `@oper/primitives` is pure TypeScript; run it in the server component. Latency budgets in `docs/perf/perf-budgets.md` bind.

---

## Task 1: `underwriteDeal` — one server function, four lenses

**Files:**
- Create: `apps/one/src/lib/underwrite-deal.ts`
- Create: `apps/one/src/lib/underwrite-deal.test.ts`

**Interfaces:**
- Consumes: `evaluateRules(inputs: PropertyInputs, cfg: RuleConfig, ctx?)` and `Strategy` from `@oper/primitives`; `resolve_rule(property_type, sale_type, strategy)` in Postgres (already used by `stats-compute.ts`).
- Produces:
  - `type LensVerdict = { strategy: Strategy; available: boolean; reason?: string; grade?: Grade; headline?: string; metrics: { label: string; value: string; met: boolean | null }[] }`
  - `underwriteDeal(dealId: string): Promise<LensVerdict[]>` — always length 4, ordered `buy_hold, brrrr, flip, str`.

- [ ] **Step 1: Write the failing test.** The honesty cases matter more than the happy path.

```ts
// apps/one/src/lib/underwrite-deal.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { query: h.query } }));

const listing = (over: Record<string, unknown> = {}) => ({
  id: '1', price: 120000, estimated_rent: 1500, sqft: 1400,
  property_type: 'Single Family', sale_type: 'standard', ...over,
});
const rule = {
  strategy: 'buy_hold', target_ratio: 0.01, down_payment_pct: 0.25,
  interest_rate: 0.07, loan_term_years: 30, closing_cost_pct: 0.03,
  property_tax_rate: 0.012, insurance_annual: 1800, fifty_pct_opex_ratio: 0.5,
};

beforeEach(() => h.query.mockReset());

describe('underwriteDeal', () => {
  it('always returns all four lenses, in a stable order', async () => {
    h.query.mockResolvedValue({ rows: [listing()] });
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('1');
    expect(out.map((v) => v.strategy)).toEqual(['buy_hold', 'brrrr', 'flip', 'str']);
  });

  it('marks STR unavailable with a reason — never a fabricated number', async () => {
    h.query.mockResolvedValue({ rows: [listing()] });
    const { underwriteDeal } = await import('./underwrite-deal');
    const str = (await underwriteDeal('1')).find((v) => v.strategy === 'str')!;
    expect(str.available).toBe(false);
    expect(str.reason).toMatch(/nightly rate|not yet/i);
    expect(str.grade).toBeUndefined();
  });

  it('marks flip unavailable when the listing has no sqft (no rehab basis)', async () => {
    h.query.mockResolvedValue({ rows: [listing({ sqft: null })] });
    const { underwriteDeal } = await import('./underwrite-deal');
    const flip = (await underwriteDeal('1')).find((v) => v.strategy === 'flip')!;
    expect(flip.available).toBe(false);
    expect(flip.reason).toMatch(/square footage/i);
  });

  it('marks buy_hold unavailable when there is no rent estimate', async () => {
    h.query.mockResolvedValue({ rows: [listing({ estimated_rent: null })] });
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;
    expect(bh.available).toBe(false);
    expect(bh.reason).toMatch(/rent estimate/i);
  });

  it('computes a buy_hold grade and metrics when inputs exist', async () => {
    h.query.mockResolvedValue({ rows: [listing()] });
    const { underwriteDeal } = await import('./underwrite-deal');
    const bh = (await underwriteDeal('1')).find((v) => v.strategy === 'buy_hold')!;
    expect(bh.available).toBe(true);
    expect(bh.grade).toMatch(/^[ABCDF]$/);
    expect(bh.metrics.map((m) => m.label)).toEqual(
      expect.arrayContaining(['Cap rate', 'DSCR', 'Cash-on-cash']),
    );
  });

  it('returns all-unavailable rather than throwing when the listing is missing', async () => {
    h.query.mockResolvedValue({ rows: [] });
    const { underwriteDeal } = await import('./underwrite-deal');
    const out = await underwriteDeal('nope');
    expect(out).toHaveLength(4);
    expect(out.every((v) => !v.available)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `cd apps/one && npx vitest run src/lib/underwrite-deal.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement it.** One listing query, one rule query per strategy, then pure math.

```ts
// apps/one/src/lib/underwrite-deal.ts
import pool from '@/lib/db';
import { evaluateRules, type Strategy, type Grade } from '@oper/primitives';

const STRATEGIES: Strategy[] = ['buy_hold', 'brrrr', 'flip', 'str'];

export interface LensMetric { label: string; value: string; met: boolean | null }
export interface LensVerdict {
  strategy: Strategy;
  available: boolean;
  /** Why we cannot underwrite this lens. Shown to the user verbatim. */
  reason?: string;
  grade?: Grade;
  headline?: string;
  metrics: LensMetric[];
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const x2 = (n: number) => n.toFixed(2);

/**
 * Underwrite one listing through all four buyer lenses.
 *
 * The engine in @oper/primitives has always been able to do this; nothing on
 * the home page ever called it. The important behaviour here is the NEGATIVE
 * path: a lens with no data source returns available:false with a reason, so
 * the UI can say "we can't underwrite this yet" instead of printing a number
 * we cannot defend. STR is unavailable by construction until an ADR feed
 * exists — see the plan's Global Constraints.
 */
export async function underwriteDeal(dealId: string): Promise<LensVerdict[]> {
  const res = await pool.query(
    `SELECT id, price, estimated_rent, sqft, property_type, sale_type
       FROM listings WHERE id = $1`,
    [dealId],
  );
  const l = res.rows[0];
  if (!l) {
    return STRATEGIES.map((s) => ({ strategy: s, available: false, reason: 'Listing not found', metrics: [] }));
  }

  const out: LensVerdict[] = [];
  for (const strategy of STRATEGIES) {
    if (strategy === 'str') {
      out.push({ strategy, available: false, metrics: [],
        reason: 'Short-term rental underwriting needs a nightly-rate feed we do not have yet.' });
      continue;
    }
    if (!l.estimated_rent || Number(l.estimated_rent) <= 0) {
      out.push({ strategy, available: false, metrics: [],
        reason: 'No rent estimate for this property yet.' });
      continue;
    }
    if ((strategy === 'flip' || strategy === 'brrrr') && !(Number(l.sqft) > 0)) {
      out.push({ strategy, available: false, metrics: [],
        reason: 'No square footage on this listing, so rehab cost cannot be estimated.' });
      continue;
    }

    const cfgRes = await pool.query(
      `SELECT * FROM resolve_rule($1, $2, $3)`,
      [l.property_type ?? 'DEFAULT', l.sale_type ?? 'standard', strategy],
    );
    const r = cfgRes.rows[0];
    if (!r) {
      out.push({ strategy, available: false, metrics: [], reason: 'No underwriting rule configured.' });
      continue;
    }

    const evaluation = evaluateRules(
      { price: Number(l.price), monthlyRent: Number(l.estimated_rent), sqft: Number(l.sqft) || undefined },
      { strategy, ...r } as never,
    );

    out.push({
      strategy,
      available: true,
      grade: evaluation.grade,
      headline: evaluation.headline,
      metrics: evaluation.results.map((x) => ({
        label: x.label,
        value: x.unit === 'percent' ? pct(x.actual ?? 0) : x2(x.actual ?? 0),
        met: x.met,
      })),
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test — expect PASS (6/6).**

- [ ] **Step 5: Verify the shapes against the real engine.** `evaluateRules`' returned field names (`grade`, `headline`, `results[].label/actual/met/unit`) must match `packages/primitives/src/underwriting.ts` exactly. Read `RuleEvaluation` and `RuleResult` there and fix any mismatch — do not guess.

```bash
grep -nE "interface RuleResult|interface RuleEvaluation" -A12 packages/primitives/src/underwriting.ts
```

- [ ] **Step 6: Commit.**

```bash
git add apps/one/src/lib/underwrite-deal.ts apps/one/src/lib/underwrite-deal.test.ts
git commit -m "feat(product): underwriteDeal — four buyer lenses, honest unavailability"
```

---

## Task 2: The verdict strip on the hero deal

**Files:**
- Create: `apps/one/src/components/home/LensVerdictStrip.tsx`
- Modify: `apps/one/src/components/home/HeroSection.tsx`

**Interfaces:**
- Consumes: `underwriteDeal`, `LensVerdict`.
- Produces: `<LensVerdictStrip verdicts={LensVerdict[]} />` — server component, no client JS.

This is the moment the claim stops being a slogan. Under the spotlight card, four small lenses show what *this* property does for four different buyers.

- [ ] **Step 1: Create the strip.**

```tsx
// apps/one/src/components/home/LensVerdictStrip.tsx
import type { LensVerdict } from '@/lib/underwrite-deal';

const LABEL: Record<string, string> = {
  buy_hold: 'Buy & hold', brrrr: 'BRRRR', flip: 'Flip', str: 'Short-term',
};

/**
 * Four buyer lenses on one property. Unavailable lenses stay visible with a
 * reason — hiding them would imply the property fails, when the truth is we
 * lack an input. Server-rendered: the underwriting math never ships to the
 * browser.
 */
export function LensVerdictStrip({ verdicts }: { verdicts: LensVerdict[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {verdicts.map((v) => (
        <div key={v.strategy} className="mat p-3" aria-label={`${LABEL[v.strategy]} verdict`}>
          <p className="prov">{LABEL[v.strategy]}</p>
          {v.available ? (
            <>
              <div className="figure mt-1 text-xl leading-none tabular-nums"
                   style={{ color: v.grade === 'A' || v.grade === 'B' ? 'var(--pass-hi)' : 'var(--text)' }}>
                {v.grade}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--mute)' }}>
                {v.metrics.slice(0, 2).map((m) => `${m.label} ${m.value}`).join(' · ')}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[11px]" style={{ color: 'var(--haze)' }}>{v.reason}</p>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Render it in `HeroSection`.** After `getSpotlightTour`, underwrite the first deal and pass it down:

```tsx
const verdicts = first ? await underwriteDeal(first.deal.id) : null;
// …inside the right column, directly under <SpotlightRotator>…
{verdicts && <LensVerdictStrip verdicts={verdicts} />}
```

- [ ] **Step 3: Verify it is in the server HTML** — this is the proof the page now ships analysis, not a photo:

```bash
curl -s http://127.0.0.1:3001 | grep -cE "Buy &amp; hold|BRRRR"
```

Expected: ≥ 1.

- [ ] **Step 4: Check the latency cost.** `underwriteDeal` adds 1 + N rule queries. Measure:

```bash
curl -s -o /dev/null -w "%{time_total}s\n" http://127.0.0.1:3001
```

Expected: within the home budget in `docs/perf/perf-budgets.md`. If it regresses, cache `resolve_rule` results per `(property_type, sale_type, strategy)` in a module-level `Map` — rules change rarely.

- [ ] **Step 5: Commit.**

```bash
git add apps/one/src/components/home/LensVerdictStrip.tsx apps/one/src/components/home/HeroSection.tsx
git commit -m "feat(product): four-lens underwriting verdict on the hero deal"
```

---

## Task 3: Make the lens switch change the verdict, not just the filter

**Files:**
- Modify: `apps/one/src/components/home/HeroSection.tsx`
- Create: `apps/one/src/components/home/LensPicker.tsx`

Today the strategy pill filters listings. After this, choosing a lens changes *how the same property is judged* — which is the product's actual argument.

- [ ] **Step 1: Create the picker** as links, not client state, so each lens is a shareable URL and the server re-renders the verdict:

```tsx
// apps/one/src/components/home/LensPicker.tsx
import Link from 'next/link';

const LENSES = [
  { id: 'buy_hold', label: 'Buy & hold' },
  { id: 'brrrr', label: 'BRRRR' },
  { id: 'flip', label: 'Flip' },
  { id: 'str', label: 'Short-term' },
] as const;

/** Server-rendered lens switch. Each lens is a real URL: shareable, crawlable,
 *  and re-underwritten on the server rather than re-filtered on the client. */
export function LensPicker({ active }: { active: string }) {
  return (
    <nav aria-label="Buyer lens" className="mt-6 flex flex-wrap gap-2">
      {LENSES.map((l) => (
        <Link key={l.id} href={`/?strat=${l.id}`} scroll={false}
          aria-current={l.id === active ? 'page' : undefined}
          className="rounded-[6px] px-3 py-1.5 text-[13px] font-medium"
          style={l.id === active
            ? { background: 'var(--brass)', color: 'var(--ink)' }
            : { background: 'var(--ink-2)', color: 'var(--haze)' }}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Lead with the active lens.** In `HeroSection`, accept `strategy` and sort its verdict first so the chosen lens is what the eye lands on:

```tsx
const active = verdicts?.find((v) => v.strategy === strategy) ?? null;
const rest = verdicts?.filter((v) => v.strategy !== strategy) ?? [];
```

Render `active` as a full-width verdict (grade + all metrics + `headline`), `rest` as the compact strip.

- [ ] **Step 3: Verify each lens is independently server-rendered.**

```bash
for s in buy_hold brrrr flip str; do
  printf "%-9s " "$s"
  curl -s "http://127.0.0.1:3001/?strat=$s" | grep -oE "Buy &amp; hold|BRRRR|Flip|Short-term" | head -1
done
```

Expected: each responds, and `str` shows its unavailability reason rather than a grade.

- [ ] **Step 4: Commit.**

```bash
git add apps/one/src/components/home/LensPicker.tsx apps/one/src/components/home/HeroSection.tsx
git commit -m "feat(product): buyer lens changes the verdict, not just the filter"
```

---

## Task 4: Show the work — an inspectable assumption trail

**Files:**
- Create: `apps/one/src/components/home/AssumptionTrail.tsx`
- Modify: `apps/one/src/components/home/HeroSection.tsx`

Anyone can print a cap rate. The defensible claim is *these are the assumptions, and here is where each came from*. `RuleConfig` already carries `isProvisional`, `ruleVersion`, `resolvedTier` and `matchedPropertyType`, and `RealCosts` carries `CostProvenance` — none of it is surfaced.

- [ ] **Step 1: Create the trail** as a native `<details>` so it costs no client JS:

```tsx
// apps/one/src/components/home/AssumptionTrail.tsx
interface Props {
  downPaymentPct: number; interestRate: number; opexRatio: number;
  resolvedTier?: string; isProvisional?: boolean; ruleVersion?: string | null;
}

/**
 * The assumptions behind the verdict, stated plainly.
 *
 * A number without its assumptions is a claim; with them it is an argument.
 * resolvedTier matters because a rule matched at DEFAULT tier is weaker
 * evidence than one matched on the exact property type — say so rather than
 * presenting both with equal confidence.
 */
export function AssumptionTrail({ downPaymentPct, interestRate, opexRatio, resolvedTier, isProvisional, ruleVersion }: Props) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[12px]" style={{ color: 'var(--haze)' }}>
        How we underwrote this
      </summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]" style={{ color: 'var(--mute)' }}>
        <dt>Down payment</dt><dd className="tabular-nums">{(downPaymentPct * 100).toFixed(0)}%</dd>
        <dt>Interest rate</dt><dd className="tabular-nums">{(interestRate * 100).toFixed(2)}%</dd>
        <dt>Operating expenses</dt><dd className="tabular-nums">{(opexRatio * 100).toFixed(0)}% of rent</dd>
        <dt>Rule match</dt><dd>{resolvedTier ?? 'default'}{isProvisional ? ' (provisional)' : ''}</dd>
        {ruleVersion && (<><dt>Rule version</dt><dd>{ruleVersion}</dd></>)}
      </dl>
      <p className="mt-2 text-[11px]" style={{ color: 'var(--haze)' }}>
        Rent is an estimate from our model, not a listed rent. Every figure here recomputes nightly.
      </p>
    </details>
  );
}
```

- [ ] **Step 2: Return the config from `underwriteDeal`.** Add `assumptions?: { downPaymentPct; interestRate; opexRatio; resolvedTier?; isProvisional?; ruleVersion? }` to `LensVerdict`, populated from the `resolve_rule` row, and add a test asserting it is present on an available lens and absent on an unavailable one.

- [ ] **Step 3: Render it under the active lens** in `HeroSection`.

- [ ] **Step 4: Verify it is server HTML** (no JS needed to open a `<details>`):

```bash
curl -s http://127.0.0.1:3001 | grep -c "How we underwrote this"
```

Expected: ≥ 1.

- [ ] **Step 5: Commit.**

```bash
git add apps/one/src/components/home/AssumptionTrail.tsx apps/one/src/lib/underwrite-deal.ts apps/one/src/lib/underwrite-deal.test.ts apps/one/src/components/home/HeroSection.tsx
git commit -m "feat(product): inspectable assumption trail under the verdict"
```

---

## Task 5: A coverage probe, so the claim stays true

**Files:**
- Create: `ops/monitoring/lens-coverage.sh`
- Create: `ops/systemd/oper-lens-coverage.{service,timer}`
- Modify: `docs/HANDOFF.md` §7

We are about to claim "we underwrite for every buyer type." That claim degrades silently if rent coverage slips or comps thin out.

- [ ] **Step 1: Write the probe** reporting, per lens, the share of active for-sale listings we can actually underwrite:

```sql
SELECT count(*) FILTER (WHERE estimated_rent > 0)                        AS buy_hold_ok,
       count(*) FILTER (WHERE estimated_rent > 0 AND sqft > 0)           AS rehab_ok,
       count(*)                                                          AS total
  FROM listings WHERE listing_status='active' AND listing_type='for_sale';
```

Alert when `buy_hold_ok / total` falls below 80% (it is 89% today). Follow `ops/monitoring/photo-coverage.sh` for the `--key` / `--resolved` structure.

**It must be index-backed** — `listings` is ~9.5 GB and this runs on a timer. `EXPLAIN` it and record the plan; a probe must cost less than what it protects (one previously seq-scanned for 9.65 s twice an hour).

- [ ] **Step 2: Report the worst lens, not just a number** — "flip coverage 71%, down from 88%" gives somewhere to start.

- [ ] **Step 3: Prove it fires and resolves** by the established method: set the threshold so it must fire, confirm the message and state file, restore, confirm RESOLVED clears it.

- [ ] **Step 4: Update `docs/HANDOFF.md` §7 and commit.**

```bash
git add ops/monitoring/lens-coverage.sh ops/systemd/oper-lens-coverage.service ops/systemd/oper-lens-coverage.timer docs/HANDOFF.md
git commit -m "feat(product): lens coverage probe — the claim cannot rot silently"
```

---

## Self-Review

**Spec coverage:** the goal was to prove analytical differentiation on the home page. T1 exposes the engine that already exists but was never called from `components/home/`; T2 puts a four-lens verdict on the hero deal; T3 makes the lens switch change the judgement rather than the filter; T4 shows the assumptions, which is what separates an argument from a claim; T5 keeps the claim honest as data shifts.

**Placeholder scan:** every task names exact files, complete code, runnable verification commands and expected output. Task 1 Step 5 deliberately instructs reading `RuleEvaluation`/`RuleResult` from source rather than trusting my field names — that is a real verification step, not a placeholder.

**Type consistency:** `LensVerdict` is defined once in T1 and consumed by name in T2–T4; `assumptions` is added to it in T4 with its test. `underwriteDeal(dealId: string)` keeps one signature throughout.

**Honest scope limits, stated rather than hidden:**
- **STR ships as unavailable.** There is no ADR source in the database. Four lenses are displayed; three are computed.
- **`tax_assessed_value` is 0% populated**, so no assessed-value feature appears anywhere in this plan.
- **This adds server queries to the hero** (1 listing + up to 3 rules). T2 Step 4 measures it and names the cache to add if the budget is breached.
- The 14 listings with a >20% ratio from bad *rent* estimates are out of scope; that is a model defect, not a presentation one.
