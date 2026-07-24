# Numbers You Can Trust — Rent Plausibility Guardrails, HPI Fix, Provenance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deal page is comprehensive and the data is broad, but a skeptical investor's first instinct is to test the numbers — and three artifacts fail that test today. (1) **~20% of the flagship "1% clearers" are model artifacts**: 9,618 active listings show `rent_price_ratio > 2%` and 8,124 cheap (<$80k) homes carry implausible rents (a $45k Tampa house "renting for $2,863/mo" = 6.4%), because the rent model imputes normal-market rent onto distressed/uninhabitable cheap stock. These pollute search, the spotlight, and the alert feed. (2) The deal page's **Market Context shows "5-yr CAGR +396.0%"** — a mislabeled full-series FHFA computation with no sanity clamp, on a sparse/outlier ZIP. (3) Only **43% of active listings carry a rent confidence band** (`rent_low`/`rent_high`); the other 57% present a single hard number with no honesty about uncertainty. This plan adds a rent-plausibility guardrail, honest confidence surfacing, and clamps/relabels the HPI metric — so every headline number either earns trust or visibly qualifies itself.

**Architecture:** A pure `assessRent(price, modelRent, hudFmr, areaComp)` classifier returns a verdict — `trusted | wide | implausible` — from the agreement between the model, HUD Fair Market Rent (already loaded on the deal page as `getHudBenchmark`), and area comps, plus an absolute price-to-rent sanity ceiling. The verdict is computed read-time (no data mutation, honoring "relabel, never delete"): `implausible` demotes the "clears the line" verdict to "unverified — model disagrees with HUD/comps", widens the displayed band, and **excludes the listing from the alert candidate query, the spotlight, and the default 1% search filter** (opt-in to see them). The FHFA CAGR is corrected (labeled by its true span), clamped to a sane range, and guarded for sparse series. Confidence surfacing extends the existing `.prov`/band motif to the 57% of listings with no band by showing an honest "point estimate — no comp band" state instead of a false-precision number.

**Tech Stack:** apps/one (deal page + `/api/properties/*` + spotlight + search server action + markets), apps/worker (`alerts.ts` candidate query), the existing `getHudBenchmark` + rent-comps paths, `fhfa_zip_hpi`, Vitest. No migration.

## Global Constraints

- **No listing data mutation.** The plausibility verdict and band are computed at read time from existing columns (`listing_price`, `estimated_rent`, `rent_low`, `rent_high`, HUD FMR, rent comps). Nothing rewrites `estimated_rent` or `rent_price_ratio`. (If a persisted flag is ever wanted, that is a separate migration-bearing plan.)
- **Relabel, never hide by deletion.** `implausible` listings stay in the database and remain reachable (direct URL, and an opt-in "include unverified" toggle) — they are only removed from the *trusted* default feeds (alerts, spotlight, default 1% search).
- **One definition of plausibility.** The thresholds live in ONE module (`apps/one/src/lib/rent-trust.ts`) and are consumed by the deal page, search, spotlight, and — as a mirrored SQL predicate, not a cross-import — the worker's candidate query. The SQL predicate and the TS thresholds must be kept identical and both cite each other in a comment.
- **Honesty over optimism:** copy never claims certainty the data lacks. A demoted deal says "model rent disagrees with HUD/comps — treat as unverified", not silence.
- **The alert dedup + lifecycle invariants are untouched** (this plan only ANDs a plausibility predicate onto the existing candidate WHERE).
- **Scraper untouched.** Read-side only.
- **Design language:** eggshell tokens + the existing `.prov`/`figure`/band motif; `--brass` for caution, not `--loss`.
- **Tests:** `pnpm --filter @oper/one test`, `pnpm --filter @oper/worker test`.

## Current State (verified 2026-07-20 on prod + code)

- Prod: 450,904 active; 48,294 clear 1% (`rent_price_ratio ≥ 0.01`); of those **9,618 have ratio > 2%**, 4,233 > 3%; **8,124** are `< $80k` with ratio > 1.5% (the cheap-stock artifact cluster). Genuine 1–2% deals: 38,679.
- Rent band: `rent_low`/`rent_high` present on **192,565 / 450,904 (43%)** active. The deal page renders the band only when both exist (`apps/one/src/app/property/[id]/page.tsx:94-95`, `rentLow`/`rentHigh` → `.band` UI at ~line 244, "p10–p90 confidence band").
- Deal page already loads HUD FMR (`getHudBenchmark(zip)`) and shows "RENT, THREE WAYS" (OnePercent model / HUD Fair Market / area comps) — the three inputs the guardrail needs are already on the page.
- The `/property/[id]/context` route computes `cagr_5yr` from `fhfa_zip_hpi` over the FULL series (`ORDER BY year ASC`, `years = last.year - first.year`) but labels it 5-yr, with **no clamp** — a sparse ZIP yields +396% (`apps/one/src/app/api/properties/[id]/context/route.ts:273-283`). Memory: `fhfa_zip_hpi.hpi` = index LEVEL, `annual_change_pct` = yearly %.
- Alert candidates (`apps/worker/src/alerts.ts` `CANDIDATES_SQL`): `rent_price_ratio BETWEEN 0.01 AND 0.05 AND price >= 30000 …` — the `0.05` ceiling and `30000` floor are the only current guardrails; the 1–5% band still admits the 2%+ artifacts.
- Spotlight (`apps/one/src/app/api/spotlight/route.ts`): sanity bounds `price ≥ 30000`, `ratio ≤ 0.05` (per memory) — same porous ceiling.
- Search default (`apps/one/src/lib/queries/properties.ts` `getProperties`): no plausibility filter; the "1% clearers" a browsing user sees include the artifacts.

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/rent-trust.ts` (create) | `assessRent()` verdict + threshold constants (the ONE definition). |
| `apps/one/src/app/property/[id]/page.tsx` (modify) | Demote verdict + widen band + honest copy when `implausible`; band-absent honest state. |
| `apps/one/src/components/property/sections/VerdictRailClient.tsx` (modify) | "Clears the line" → "Unverified" treatment for `implausible`. |
| `apps/one/src/lib/queries/properties.ts` (modify) | Default 1% feed excludes `implausible` unless `includeUnverified`. |
| `apps/one/src/app/api/spotlight/route.ts` (modify) | Spotlight excludes `implausible`. |
| `apps/worker/src/alerts.ts` (modify) | Candidate query ANDs the mirrored plausibility predicate. |
| `apps/one/src/app/api/properties/[id]/context/route.ts` (modify) | CAGR: true-span label + clamp + sparse guard. |

---

## Task 1: The plausibility classifier (pure)

**Files:** create `apps/one/src/lib/rent-trust.ts` + `rent-trust.test.ts`.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest';
import { assessRent, RENT_TRUST } from './rent-trust';

const base = { price: 245000, modelRent: 2767, hudFmr: 1900, areaComp: 2950 };

describe('assessRent', () => {
  it('trusted when model agrees with HUD/comps and ratio is sane', () => {
    expect(assessRent(base).verdict).toBe('trusted');
  });
  it('implausible when monthly rent exceeds the absolute price ceiling', () => {
    // $45k home, $2,863/mo = 6.4% — far above RENT_TRUST.maxRatio (0.02)
    expect(assessRent({ price: 45000, modelRent: 2863, hudFmr: 1100, areaComp: 1200 }).verdict)
      .toBe('implausible');
  });
  it('implausible when the model dwarfs HUD FMR beyond the divergence cap', () => {
    // model 2.4x HUD with no comp support
    expect(assessRent({ price: 120000, modelRent: 2600, hudFmr: 1050, areaComp: null }).verdict)
      .toBe('implausible');
  });
  it('wide (not implausible) when model and comps disagree moderately', () => {
    expect(assessRent({ price: 245000, modelRent: 2767, hudFmr: 1900, areaComp: 2100 }).verdict)
      .toBe('wide');
  });
  it('trusted with missing HUD/comps if the ratio is plainly sane (falls back to ratio only)', () => {
    expect(assessRent({ price: 245000, modelRent: 2400, hudFmr: null, areaComp: null }).verdict)
      .toBe('trusted');
  });
  it('returns the ratio and a human reason string', () => {
    const r = assessRent({ price: 45000, modelRent: 2863, hudFmr: 1100, areaComp: 1200 });
    expect(r.ratio).toBeCloseTo(0.0636, 4);
    expect(r.reason).toMatch(/exceeds|disagree/i);
  });
});
```

- [ ] **Step 2: RED → implement.** `RENT_TRUST = { maxRatio: 0.02, hudDivergence: 1.6, compDivergence: 1.4 }` (monthly-rent-to-price ceiling; max model/HUD and model/comp multiples before "implausible"). Logic:
  - `ratio = modelRent / price` (guard price ≤ 0 → `implausible`, reason "no price").
  - If `ratio > maxRatio` AND not corroborated (no comp within `compDivergence` of model) → `implausible`.
  - Else if `hudFmr` present and `modelRent / hudFmr > hudDivergence` and (no `areaComp` or `modelRent/areaComp > compDivergence`) → `implausible`.
  - Else if any available anchor (HUD or comp) diverges moderately (`> 1.25×` but within the implausible caps) → `wide`.
  - Else → `trusted`. Return `{ verdict, ratio, reason }`. Pure, no IO.
- [ ] **Step 3:** Tests green; typecheck; commit — `feat(trust): rent plausibility classifier (single source of thresholds)`

## Task 2: Deal page honors the verdict

**Files:** modify `apps/one/src/app/property/[id]/page.tsx`, `apps/one/src/components/property/sections/VerdictRailClient.tsx` (+ its test).

- [ ] **Step 1: Failing test** (VerdictRailClient jsdom): given `verdict='implausible'`, the rail renders "Unverified — model rent disagrees with HUD/comps" in `--brass` (not the green "Clears the line"), and the ratio figure carries a caution marker; `verdict='wide'` shows the ratio with a "wide band" note; `verdict='trusted'` is unchanged (green clears-the-line when ratio ≥ target).
- [ ] **Step 2: RED → implement.** In the page, compute `const rentAssessment = assessRent({ price, modelRent: rent, hudFmr: hudData?.fmr ?? null, areaComp: <area comp median already on page> })` and thread `rentAssessment` into `VerdictRailClient`. When `implausible`: the verdict headline is the caution copy, and the displayed band widens to `[min(price*0.004, hudFmr), max(modelRent, areaComp)]`-style honest range (or, if no anchors, an explicit "estimate unverified" with no fabricated bounds). When band data is absent entirely (the 57%) and verdict is `trusted`, show "point estimate — add comps for a band" rather than a bare confident number.
- [ ] **Step 3:** Full one suite + typecheck; commit — `feat(trust): deal page demotes unverified rents and stops false-precision`

## Task 3: Trusted feeds exclude artifacts

**Files:** modify `apps/one/src/lib/queries/properties.ts`, `apps/one/src/app/api/spotlight/route.ts`, `apps/worker/src/alerts.ts` (+ tests for each).

- [ ] **Step 1: Define the mirrored SQL predicate.** The plausibility exclusion as a SQL fragment that matches `RENT_TRUST.maxRatio` without HUD/comp joins (those aren't available in the bulk feeds): `rent_price_ratio <= 0.02` is the bulk proxy for the absolute ceiling. Put the exact string in a shared const comment referencing `RENT_TRUST.maxRatio` in `rent-trust.ts` so drift is visible. (The richer HUD/comp check stays deal-page-only; the bulk feeds use the ratio ceiling, which removes the 9,618 artifacts.)
- [ ] **Step 2: Failing tests:**
  - `getProperties` default (no `includeUnverified`) adds `AND rent_price_ratio <= 0.02` to the 1%-clearing branch; passing `includeUnverified: true` drops it. (Assert on generated SQL or on filtered rows via the existing test harness.)
  - spotlight route: candidates never include a listing with ratio > 0.02 (add a fixture row at 0.03 → excluded).
  - `alerts.ts`: `CANDIDATES_SQL` contains `rent_price_ratio <= 0.02` (tighten the existing `<= 0.05`); the existing tier-split tests stay green.
- [ ] **Step 3: RED → implement** all three. In `alerts.ts` change the candidate ceiling `0.05 → 0.02` in both `CANDIDATES_SQL` and `CANDIDATES_SQL_NO_LIFECYCLE`, and update the assertion in `alerts.test.ts` accordingly. Add the `includeUnverified` param to `getProperties` (default false) and the search page's opt-in toggle (nuqs `unverified` param, mirroring the existing `sold` toggle pattern).
- [ ] **Step 4:** Both suites + typecheck; commit — `feat(trust): alerts, spotlight, and default search exclude implausible-rent listings (opt-in to see them)`

## Task 4: Fix the HPI/CAGR metric

**Files:** modify `apps/one/src/app/api/properties/[id]/context/route.ts` + a unit test for the extracted CAGR helper.

- [ ] **Step 1: Extract + failing tests.** Pull the CAGR math into a pure `computeHpiCagr(series: {year,hpi}[])` returning `{ cagrPct, spanYears } | null`. Tests:
  - a clean 10-yr level series (100 → 180) → `cagrPct ≈ 6.05`, `spanYears = 10`.
  - a sparse 2-point outlier (100 → 496 one year apart) → returns `null` (or a clamped/flagged value) because `cagrPct` exceeds the sanity clamp `HPI_MAX_CAGR = 25` — implausible growth is suppressed, not shown as +396%.
  - `< 2` points or `first.hpi ≤ 0` → `null`.
  - the result carries `spanYears` so the UI can label it truthfully (not hardcode "5-yr").
- [ ] **Step 2: RED → implement.** `computeHpiCagr` clamps to `null` when `|cagrPct| > HPI_MAX_CAGR` (=25) OR `spanYears < 3` (too sparse to annualize honestly). The route returns `{ series, cagr: cagrPct, cagrSpanYears: spanYears }`; the deal page's Market Context labels it `${spanYears}-yr CAGR` (or hides the row when `cagr` is null) — no more "+396%", no more mislabeled "5-yr".
- [ ] **Step 3:** Test green; typecheck; commit — `fix(trust): HPI CAGR labeled by true span, clamped, sparse-series guarded (kills +396%)`

## Task 5: Deploy + trust proof

- [ ] **Step 1:** `bash ops/systemd/deploy-systemd.sh app worker-alerts` (rm worker dist first per the tsc-incremental gotcha).
- [ ] **Step 2: Artifact-exclusion proof (DB + HTTP):** the earlier extreme listings (e.g. id 358 Tampa $45k/6.36%) return `verdict: implausible` on the deal page (shows the caution copy, not "clears the line"); default `/search` for a metro no longer surfaces ratio > 2% cards, but the "include unverified" toggle brings them back; the alert tick's candidate count drops (log `candidates` reflects the tighter `<= 0.02` ceiling) and no 2%+ listing appears in `alert_events`.
- [ ] **Step 3: HPI proof:** the property page whose Market Context read "+396%" now shows either a sane `${span}-yr CAGR` within ±25% or a hidden row; spot-check 3 sparse ZIPs — none render an absurd CAGR.
- [ ] **Step 4: Band-honesty proof:** a listing with no `rent_low`/`rent_high` shows the honest point-estimate state, not a false-precision confident band; a `wide`-verdict listing shows the widened band + note.
- [ ] **Step 5: No-regression:** genuine 1–2% deals (the 38,679) still show green "clears the line"; suites green in CI; scraper/crawl cadence untouched.

## Self-Review

**Spec coverage:** the 9,618 rent artifacts stop polluting trusted feeds and self-label on their own pages (T1–T3) · the +396% HPI bug is fixed, clamped, and truthfully labeled (T4) · the 57% band-less listings stop projecting false precision (T2) · one threshold definition shared across page/search/spotlight/worker (T1, T3 constraint) · deployed with artifact/HPI/band proofs (T5). Covered.

**Placeholder scan:** every task names exact files with complete classifier logic, thresholds, and SQL fragments; the one "area comp median already on page" reference points at data the page already computes (RENT, THREE WAYS) — Step 2 threads the existing value.

**Type consistency:** `assessRent` returns one `{ verdict: 'trusted'|'wide'|'implausible', ratio, reason }` shape consumed by the page + VerdictRail (T2); the bulk SQL proxy (`rent_price_ratio <= 0.02`) is documented as the mirror of `RENT_TRUST.maxRatio` (T3); `computeHpiCagr` returns `{ cagrPct, spanYears }` consumed by the context route + Market Context label (T4). No cross-task drift.
