# The Investor's Shelf — Saved Properties, Compare, Investor Presets

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Shelf the investor's workbench. Today "Add to watchlist" on a property page crams a single listing into a *criteria* watchlist and the Shelf never shows it — the user saves a property and it vanishes. This plan adds true per-listing saves (the Shelf's first section), one-tap compare of shelf picks (the `/compare` page already exists), and an investor-preset profile — financing assumptions and watched areas — that pre-fills every calculator and underwriting default on the site.

**Architecture:** New `saved_properties` table (user ↔ listing, with a note) + session-scoped CRUD API + a Save button on property page and search cards. The Shelf becomes three sections: **Saved properties** (cards with checkboxes → Compare), **Watched searches** (the existing criteria watchlists, renamed honestly), **Presets** (link to `/account`). `profiles.prefs` (jsonb) stores financing + area presets; a small `usePrefs()` hook + server helper feed the calculator, ValuationPanel, and underwriting defaults.

**Tech Stack:** Next 16 App Router (apps/one), existing session auth (`getSessionUser`), Postgres migration, `@oper/primitives` cost resolution, Vitest.

## Global Constraints

- **Session identity only** — every API route derives `user_id` from `getSessionUser()`; no client-supplied user ids (the codebase's Wave-5 standard).
- **Watchlists stay criteria-based.** No schema change to `watchlists`; the property page stops abusing them. Copy renames them "Watched searches" wherever surfaced.
- **Sold/misfiled rows may be saved** (a shelf is a scrapbook): saved cards render whatever lifecycle badge the listing carries (integrates with the Listing Truth plan; degrade gracefully if that plan hasn't shipped: no badge).
- **Compare reuses `/compare?ids=`** exactly as built (free tier caps at `COMPARE_FREE_MAX`, pro unlimited — do not re-implement the gate).
- **Presets are defaults, not overrides:** any calculator input the user edits by hand wins for that session; presets only pre-fill.
- **Design language:** eggshell "line" tokens + `.prov/.mat/.figure` utilities; no new colors.
- **Tests:** Vitest colocated; `pnpm --filter @oper/one test <path>`; TSX tests use the jsdom pragma.

## Current State (verified 2026-07-18)

- `apps/one/src/app/shelf/page.tsx` fetches `/api/watchlists` + `/api/saved-searches` only. No per-listing saves exist anywhere (`favorites|saved_listing|shelf_item` grep: zero hits).
- Property page save path: `apps/one/src/components/property/sections/VerdictRailClient.tsx` + `MenuHeader.tsx` POST to `/api/watchlists` (criteria CRUD, `query_json`) — the semantic mismatch behind "it doesn't go to my shelf".
- `/compare/page.tsx` takes `?ids=a,b,c`, `useProperties(ids, { compare: true })`, `COMPARE_FREE_MAX` gate — working.
- `profiles` columns: `id, email, password_hash, subscription_tier, stripe_customer_id, created_at, updated_at` — **no prefs**.
- Calculator lives at `/playbook/calculator`; underwriting defaults come from `@oper/primitives` cost resolution (`resolveCosts`) + `property_type_rules`.

## File Structure

| File | Responsibility |
|---|---|
| `infrastructure/migrations/2026_07_18_saved_properties_prefs.sql` (create) | `saved_properties` table + `profiles.prefs jsonb`. |
| `apps/one/src/app/api/saved-properties/route.ts` (create) | GET (list, hydrated with listing cards) / POST {listingId, note?} / DELETE ?id=. |
| `apps/one/src/app/api/prefs/route.ts` (create) | GET/PUT the session user's prefs (validated). |
| `apps/one/src/lib/prefs.ts` (create) | `type InvestorPrefs`, `DEFAULT_PREFS`, `parsePrefs(json)`, `usePrefs()` client hook. |
| `apps/one/src/components/SaveButton.tsx` (create) | Heart/save toggle, optimistic, used on property page + SearchCard. |
| `apps/one/src/components/property/sections/VerdictRailClient.tsx` + `MenuHeader.tsx` (modify) | Save button replaces the watchlist misuse; "Watch this search" remains only where criteria make sense (search page). |
| `apps/one/src/app/shelf/page.tsx` (modify) | Three sections; checkbox-select saved cards → Compare CTA. |
| `apps/one/src/app/account/page.tsx` (modify) | Presets editor (financing + watched areas). |
| `apps/one/src/app/playbook/calculator/…` + `apps/one/src/components/property/ValuationPanel.tsx` (modify) | Read prefs as defaults. |

---

## Task 1: Migration — `saved_properties` + `profiles.prefs`

- [ ] **Step 1: Write it**

```sql
-- infrastructure/migrations/2026_07_18_saved_properties_prefs.sql
CREATE TABLE IF NOT EXISTS saved_properties (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id  bigint NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_properties_user ON saved_properties (user_id, created_at DESC);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_properties TO oper_app;
GRANT USAGE, SELECT ON SEQUENCE saved_properties_id_seq TO oper_app;
```

(Verify the app's DB role name in `/etc/oper.env` on deploy — repo convention is `oper_app`; adjust the GRANT if the live role differs.)

- [ ] **Step 2: CI dry-run green; commit** — `feat(data): saved_properties + profiles.prefs`

---

## Task 2: Prefs domain — `InvestorPrefs` type, validation, hook

**Interfaces:**
- Produces (in `apps/one/src/lib/prefs.ts`):

```ts
export type InvestorPrefs = {
  financing: {
    ratePct: number;        // annual mortgage rate, e.g. 6.5
    downPct: number;        // 0-100
    termYears: number;      // 15|20|30 typical
    taxRatePct: number | null;      // null = use market default
    insuranceMoYr: number | null;   // annual $, null = market default
    mgmtPct: number;        // property management % of rent
    vacancyPct: number;
  };
  areas: Array<{ label: string; zip: string }>;  // watched areas (metro chips or ZIPs)
  strategy: 'buy_hold' | 'brrrr' | 'flip' | 'str';
};
export const DEFAULT_PREFS: InvestorPrefs;
export function parsePrefs(json: unknown): InvestorPrefs;  // lenient: merges onto defaults, clamps ranges
export function usePrefs(): { prefs: InvestorPrefs; save(p: InvestorPrefs): Promise<boolean>; loading: boolean };
```

- [ ] **Step 1: Failing tests** (`apps/one/src/lib/prefs.test.ts`): `parsePrefs({})` → DEFAULT_PREFS; `parsePrefs({financing:{ratePct: 99}})` clamps to ≤ 15; `parsePrefs({areas:[{label:'Houston',zip:'77002'}]})` round-trips; malformed area entries dropped.
- [ ] **Step 2: RED → implement (pure `parsePrefs` with explicit clamp table: ratePct 0–15, downPct 0–100, termYears 5–40, mgmtPct 0–30, vacancyPct 0–30; zip must match `^\d{5}$`) → GREEN.**
- [ ] **Step 3: `/api/prefs` route** — GET returns `parsePrefs(profiles.prefs)`; PUT validates via `parsePrefs` then writes the CLEANED object (never raw client json). 401 without session. Session pattern: copy from `/api/watchlists`.
- [ ] **Step 4: `usePrefs()`** — fetch on mount, optimistic save, exposes loading.
- [ ] **Step 5: Commit** — `feat(user): investor prefs — validated jsonb, API, hook`

---

## Task 3: Saved properties API + SaveButton

- [ ] **Step 1: Failing route test** (`apps/one/src/app/api/saved-properties/route.test.ts`, mock db pool + session like the watchlists tests): POST inserts once, second POST same listing → 200 idempotent (ON CONFLICT DO NOTHING + returns existing); GET returns hydrated rows newest-first; DELETE only touches the session user's row; all three 401 without a session.
- [ ] **Step 2: Implement** — GET joins listings for card data:

```sql
SELECT sp.id AS save_id, sp.note, sp.created_at AS saved_at,
       l.id::text AS id, l.address, l.price, l.estimated_rent, l.rent_price_ratio,
       l.listing_status, l.sold_price, l.sold_date,
       COALESCE(l.primary_photo, l.images->>0) AS primary_photo, l.zip_code
  FROM saved_properties sp JOIN listings l ON l.id = sp.listing_id
 WHERE sp.user_id = $1 ORDER BY sp.created_at DESC LIMIT 200
```

(`listing_status/sold_*` may not exist until the Listing Truth plan ships — guard with a feature-detect try/catch fallback SELECT without those columns, same 42703 pattern as the markets 42P01 fallback.)
- [ ] **Step 3: `SaveButton.tsx`** — client component `{listingId, initialSaved?}`: heart outline/filled (inline SVG, `var(--brass)` when saved), optimistic toggle, POST/DELETE, signed-out → link to `/account?next=…` with a small "Sign in to save" title. jsdom test: toggles on click with mocked fetch, renders link when `fetch` 401s.
- [ ] **Step 4: Mount** — property page (`VerdictRailClient.tsx`: the "add to watchlist" action becomes SaveButton; `MenuHeader.tsx` same; keep "Watch this search" ONLY on the search page where criteria exist) and `SearchCard.tsx` (top-right corner of the mat, stopPropagation so the card link doesn't fire).
- [ ] **Step 5: Full suite + typecheck; commit** — `feat(user): true per-listing saves — API + SaveButton on property/search`

---

## Task 4: Shelf rework — sections + compare flow

- [ ] **Step 1: Failing test** (`apps/one/src/app/shelf/shelf.test.tsx`, jsdom, mock fetches): renders "Saved properties" section with 2 mocked saves; checking two boxes enables a "Compare (2)" link with `href="/compare?ids=A,B"`; renders "Watched searches" header for the watchlists section.
- [ ] **Step 2: Implement** — `shelf/page.tsx`:
  - Section 1 **Saved properties**: grid of compact cards (photo via the COALESCEd `primary_photo`, address, price, ratio `figure`, optional note, lifecycle badge when present). Checkbox per card; sticky bottom bar appears when ≥2 checked: `Compare (n) →` linking `/compare?ids=…` (cap UI selection at 4; the compare page's own pro gate handles entitlement), plus `Remove` batch action.
  - Section 2 **Watched searches** (rename from "watchlists" in copy only), unchanged behavior.
  - Section 3 **Presets** teaser: current rate/down/strategy line + "Edit presets →" to `/account#presets`.
  - Empty states for each ("Save a property from any card — the ♥").
- [ ] **Step 3: Full suite + typecheck; commit** — `feat(user): shelf = saved properties + compare picks + watched searches`

---

## Task 5: Presets power the calculators

- [ ] **Step 1: Account editor** — `/account` gains a `#presets` section: financing inputs (rate %, down %, term, tax %, insurance $, mgmt %, vacancy %), strategy select, watched-areas chip input (label+zip, reuse `METROS` for quick-add chips). Saves via `usePrefs().save`; optimistic with saved-tick. jsdom test: renders defaults, edits rate, save called with clamped value.
- [ ] **Step 2: Calculator pre-fill** — `/playbook/calculator`: on mount, seed inputs from `usePrefs()` (only fields the user hasn't touched — keep a `dirty` set). Test: with prefs {ratePct: 5.5}, the rate input initializes to 5.5.
- [ ] **Step 3: ValuationPanel + underwriting defaults** — where the property page computes owner-return/cash-flow (ValuationPanel and the scorecard's cost resolution), thread prefs: client fetch of `/api/prefs` → pass overrides into the existing cost-resolution call (the primitives already accept per-call overrides; verify the exact signature in `packages/primitives` — `resolveCosts(listing, overrides?)` pattern — and pass `{ ratePct, downPct, termYears, taxRatePct, insuranceMoYr, mgmtPct, vacancyPct }` mapped to its field names).
- [ ] **Step 4: Search integration (small)** — search page "My areas" quick chips above results when prefs.areas is non-empty: clicking sets the ZIP filter (client-side param only).
- [ ] **Step 5: Full suite + typecheck; commit** — `feat(user): presets pre-fill calculator, valuation, and search areas`

---

## Task 6: Deploy + verification

- [ ] Migrate, build, restart `oper-app`. Then live: sign in → save a property from a search card (heart fills) → `/shelf` shows it instantly → save a second → select both → Compare renders the two side-by-side → set rate 5.0%/down 30% in `/account#presets` → calculator opens pre-filled → property-page owner numbers shift accordingly → "Watched searches" still lists the old watchlists → signed-out heart links to sign-in. Screenshot the shelf for the PR.

## Self-Review

**Spec coverage:** "add to watchlist doesn't go to my shelf" fixed at the semantic root (per-listing saves, T1–T3, property-page misuse replaced T3) · "compare things on my shelf" (T4, reusing the shipped compare + its pro gate) · "preset areas I want to watch" (prefs.areas T2/T5 + search chips) · "preset rates or % … preset in the calculators" (T5 pre-fill + valuation threading) · "more features like that" (notes on saves, strategy default, batch remove). Covered.

**Placeholder scan:** all schemas/types/SQL complete; the two verify-on-site integration points (primitives override signature, live DB role name for GRANTs) are named precisely with the fallback behavior specified.

**Type consistency:** `InvestorPrefs` defined once (T2) and consumed by account/calculator/valuation (T5); `saved_properties` columns match the GET hydration SQL (T3) and the shelf cards (T4); compare contract stays `?ids=` (T4 links only — no compare-page changes).

## Deferred (from PR #40 review + session)

- [ ] **DEF-1 — saved-properties GET/DELETE test coverage.** `route.test.ts` covers only POST after the review rework; GET hydration + DELETE (`?id=` and `?listingId=`) are untested on this branch. Restore coverage.
- [ ] **DEF-2 — Shelf status badge pending Listing Truth.** GET guards `listing_status`/`sold_*` behind a 42703 fallback; those columns don't exist yet, so the badge is always absent. Wire to the Listing Truth plan when it ships.
- [ ] **DEF-3 — prefs shared-state dedup (D1).** `prefs-shared.ts` extraction left potential client/server state duplication; revisit when presets expand.
- [ ] **DEF-4 — account cosmetic test (D2).** Minor test-shape cleanup in `account/page.test.tsx` deferred as low-value.
