# Pro Conviction — Execution Plan (file-level)

> Reconnoitered against `oper-pro-conviction` @ branch `pro-conviction` on 2026-07-19.
> Supersedes the stale `2026-07-19-pro-conviction.md`. Webhook (Task 4) and billing
> portal route are already built; this plan covers what remains.

## Verified facts (read, not assumed)

- **Webhook sync done.** `apps/one/src/app/api/webhooks/route.ts` already sets
  `subscription_tier` on `checkout.session.completed` + `customer.subscription.{created,updated,deleted}`,
  idempotent + DLQ-guarded. No work there.
- **Billing portal route exists at `/api/checkout/portal`** (NOT `/api/billing/portal`).
  `apps/one/src/app/api/checkout/portal/route.ts` queries `profiles.stripe_customer_id`,
  returns `{ url }` / 401 / 400 / 500. Account page must POST here.
- **`getSessionUser()` does NOT expose `stripe_customer_id`.** `apps/one/src/lib/auth.ts:29-33`
  `SessionUser` = `{ id, email, tier }`. `useSessionUser` (client) mirrors that shape.
  So the account "Manage billing" link needs `stripe_customer_id` from somewhere else
  (see Task 5).
- **Layouts cap already enforced server-side** in `apps/two/src/app/api/layouts/route.ts`
  (`FREE_CAP=5`, `PRO_CAP=20`, 403 `LAYOUT_CAP`). GET returns `res.rows` with no `limits`.
- **`COMPARE_FREE_MAX` duplicated** in two places: `apps/one/src/components/compare/useCompare.tsx:11`
  (`COMPARE_FREE_MAX=2`, `COMPARE_MAX=4`) and `apps/one/src/app/api/properties/route.ts:11`
  (`COMPARE_FREE_MAX=2`, `COMPARE_PRO_MAX=4`). Single source needed (Task 1).
- **Client tier gating** for compare lives in `useCompare.tsx:31` (`limit = isPro ? COMPARE_MAX : COMPARE_FREE_MAX`)
  and `apps/one/src/app/page.tsx:134` (`compareLimit`). Compare page over-cap branch:
  `apps/one/src/app/compare/page.tsx:46`.
- **Shelf compare bar** at `apps/one/src/app/shelf/page.tsx:267-290`. Uses `MAX_SELECT`
  (defined earlier in that file) and `compareHref = selected.length >= 2`.
- **AlertsBell** `apps/one/src/components/AlertsBell.tsx` — dropdown footer is the empty-state
  `<p>` at lines 157-160; the `prov`/`brass-hi` tokens are used for the "Mark all read" button.
- **Two layout bar** is `LayoutBar` in `apps/two/src/components/Workspace.tsx:200-339`,
  driven by `canSaveLayout` (= `isPro`, set at `TerminalClient.tsx:566`). It already hides save
  for free. The upgrade line for *used>=max* must be added here (Task 6).
- **Test infra:** `apps/one/vitest.config.ts` exists; `.test.tsx` auto-run in jsdom
  (`environmentMatchGlobs`). `apps/two` has **NO vitest config and NO tests** — Task 6 "component
  test" requires standing up a minimal `apps/two/vitest.config.ts` (alias `@` → `src`, jsdom for
  `*.test.tsx`) and a dev dependency, OR relying on typecheck only. Flag as risk.
- **Design tokens** (light/eggshell by default): `--brass`/`--brass-hi` (caution/below),
  `--pass`/`--pass-hi` (clears), `--ink`, `--ink-2`, `--ink-panel`, `--line`, `--haze`,
  `--mute`, `--loss`, `--card`. Utility classes: `bg-pass`, `text-brass-hi`, `border-line`,
  `prov`, `prov--real`, `prov--est`, `prov--brass`, `figure--pass`. UpgradeMoment should use
  `var(--brass-hi)` for the CTA + `border-line`/`bg-ink-2` surface to match the shelf/cards.

---

## Task 1 — `apps/one/src/lib/entitlements.ts` + consolidate COMPARE cap

**Create** `apps/one/src/lib/entitlements.ts`:

```ts
export type Tier = 'free' | 'pro';
export type Gate = 'compare' | 'alerts' | 'layouts';

// Single source of truth for cap numbers (was duplicated in useCompare.tsx + properties/route.ts).
export const COMPARE_FREE_MAX = 2;
export const COMPARE_PRO_MAX = 4;
// layouts caps mirror apps/two/src/app/api/layouts/route.ts FREE_CAP/PRO_CAP.
export const LAYOUT_FREE_MAX = 5;
export const LAYOUT_PRO_MAX = 20;

export interface Entitlement {
  tier: Tier;
  compareMax: number;
  layoutsMax: number;
  alerts: 'daily' | 'instant';
  // human strings for the pricing table rows
}

export const ENTITLEMENTS: Record<Tier, Entitlement> = {
  free: { tier: 'free', compareMax: COMPARE_FREE_MAX, layoutsMax: LAYOUT_FREE_MAX, alerts: 'daily' },
  pro:  { tier: 'pro',  compareMax: COMPARE_PRO_MAX,  layoutsMax: LAYOUT_PRO_MAX,  alerts: 'instant' },
};

export function entitlementsFor(tier: Tier | undefined | null): Entitlement {
  return ENTITLEMENTS[tier === 'pro' ? 'pro' : 'free'];
}
```

**Refactor (remove duplication):**
- `apps/one/src/components/compare/useCompare.tsx`: delete local `COMPARE_MAX`/`COMPARE_FREE_MAX`
  (lines 10-11); `import { COMPARE_FREE_MAX, COMPARE_PRO_MAX } from '@/lib/entitlements'`. Keep
  `COMPARE_MAX` as a re-export if other files import it (`export const COMPARE_MAX = COMPARE_PRO_MAX`)
  — `page.tsx:32` imports `COMPARE_FREE_MAX`, `page.tsx:134` imports both. Replace `useCompare`
  `limit` calc (line 31) with `const limit = isPro ? COMPARE_PRO_MAX : COMPARE_FREE_MAX`.
- `apps/one/src/app/page.tsx:32`: replace `COMPARE_FREE_MAX, COMPARE_MAX` import with the
  entitlements constants (use `COMPARE_PRO_MAX`).
- `apps/one/src/app/api/properties/route.ts:11-12`: import `COMPARE_FREE_MAX`/`COMPARE_PRO_MAX`
  from `@/lib/entitlements` instead of local consts; keep server-side gate logic identical.

**Test:** `apps/one/src/lib/entitlements.test.ts` (jsdom per config):
- `entitlementsFor('pro').compareMax === 4`, `.layoutsMax === 20`, `.alerts === 'instant'`.
- `entitlementsFor('free')` → 2 / 5 / 'daily'; `entitlementsFor(undefined)`/`null` → free defaults.
- `ENTITLEMENTS` map has exactly `free`/`pro`.

**Risks:** none — pure refactor; run `pnpm --filter @oper/one test` + `typecheck` after.

---

## Task 2 — `apps/one/src/components/UpgradeMoment.tsx`

**Create** `apps/one/src/components/UpgradeMoment.tsx` (`'use client'`):

Props (keep minimal):
```ts
interface UpgradeMomentProps {
  gate: 'compare' | 'alerts' | 'layouts';
  /** optional override text; default per-gate copy below */
  freeAlt?: string;
  className?: string;
}
```
Behavior:
- Renders a bordered surface (`border-line bg-ink-2 rounded-[var(--r-panel)] p-6`) with a brass
  accent rule, a short headline, and a free-alternative line, plus a CTA `Link` to
  `/pricing?from=<gate>` (uses `next/link`). CTA styled `bg-pass text-white` with brass ring on focus.
- Per-gate defaults:
  - `compare`: "Compare is a Pro feature." / free alt: "Free accounts compare up to 2 side by side."
  - `alerts`: "Instant alerts are Pro." / free alt: "FreeWatch sends one daily digest instead."
  - `layouts`: "Pro Terminal holds 20 layouts." / free alt: "Free desk keeps 5 saved screens."
- `?from=<gate>` is the brass-ring hook the pricing page reads (Task 4).
- Match tokens: `text-brass-hi` for the accent label, `prov prov--real`/`prov--brass` for the badge,
  `text-haze` for the free-alt line.

**Test:** `apps/one/src/components/UpgradeMoment.test.tsx` (jsdom):
- Renders headline + CTA link with `href="/pricing?from=compare"` for `gate="compare"`.
- `freeAlt` override replaces default alt line.
- Each gate value renders a distinct, non-empty CTA href containing `from=<gate>`.

**Risks:** none.

---

## Task 3 — Integrate UpgradeMoment at the 3 gates (apps/one)

### 3a. Compare page over-cap branch — `apps/one/src/app/compare/page.tsx:46-57`
- Keep first `COMPARE_FREE_MAX` rows visible (do NOT blank the page). Change the early-return so it
  still renders the table for `ids.slice(0, COMPARE_FREE_MAX)` and appends `<UpgradeMoment gate="compare" />`
  below the table (or a side rail) when `ids.length > COMPARE_FREE_MAX` and not pro.
- Simplest: compute `visibleIds = isPro ? ids : ids.slice(0, COMPARE_FREE_MAX)`, pass `visibleIds`
  to `useProperties`/`properties`, and after the table render `<UpgradeMoment gate="compare" />` when
  over cap. Import `COMPARE_FREE_MAX` from entitlements.

### 3b. AlertsBell dropdown footer — `apps/one/src/components/AlertsBell.tsx:138-191`
- Need `isPro`. AlertsBell currently has no session hook — add `const session = useSessionUser()`
  (`@/lib/useSessionUser`). When `!session?.tier || session.tier !== 'pro'`, render
  `<UpgradeMoment gate="alerts" />` as the dropdown footer (below the empty-state `<p>` or below the
  list), styled to fit the existing `bg-card/95` popover. Keep the existing empty-state copy for
  `alerts.length === 0`.
- Risk: `useSessionUser` does a `/api/auth/me` fetch; AlertsBell already fetches `/api/alerts`, so the
  extra call is negligible. Guard for null session (anon users) → show upgrade footer too.

### 3c. Shelf compare bar — `apps/one/src/app/shelf/page.tsx:267-290`
- Today the bar shows `Compare ({selected.length})` whenever `selected.length >= 2`. For a free user
  near/over `COMPARE_FREE_MAX` (2), the bar should disable past cap with a tooltip and surface
  `<UpgradeMoment gate="compare" />` (or an inline mini-paywall) instead of silently truncating.
- Need `isPro` in shelf page — check if `useSessionUser` is already used there; if not, import it.
- Implementation: cap `selected.length` display to `COMPARE_FREE_MAX` for free; when
  `selected.length > COMPARE_FREE_MAX && !isPro`, render the Compare button disabled with
  `title="Free accounts compare up to 2 — upgrade for 4"` and show `<UpgradeMoment gate="compare" />`
  (compact variant) above/below the bar. Keep the page honest — don't hide the user's selections.
- Note: the existing compare logic selects up to the cap already (`useCompare.add` enforces `limit`).
  The shelf bar's `selected` is a separate local set — confirm whether it is capped. If uncapped,
  gate the `compareHref` on `Math.min(selected.length, isPro ? COMPARE_PRO_MAX : COMPARE_FREE_MAX)`.

**Tests:** extend `apps/one/src/app/shelf/shelf.test.tsx` if feasible (jsdom) to assert the disabled
state/tooltip for a free session; otherwise manual + typecheck. Add a small `UpgradeMoment` render
coverage under Task 2.

**Risks / open questions:**
- Does `shelf/page.tsx` already consume `useSessionUser`? (verify — grep showed it uses `useSavedSearches`,
  not session). Will add import.
- Confirm whether shelf `selected` is capped by `useCompare` or independent; affects gate logic.

---

## Task 4 — Rewrite `apps/one/src/app/pricing/page.tsx` from ENTITLEMENTS

**Rewrite** the page to derive the Free/Pro columns from `ENTITLEMENTS` (`@/lib/entitlements`):
- Two columns Free / Pro generated from `entitlementsFor('free')` / `entitlementsFor('pro')`; rows
  built from a small static `ROWS` array (label + free value + pro value), e.g.
  `Compare side-by-side` → `2` / `4`, `Saved layouts (Pro Terminal)` → `5` / `20`,
  `Alerts` → `Daily digest` / `Instant`. Plus the existing marketing truths (unlimited saves, PDF
  exports, watchlist alerts) as static Pro features.
- Pro CTA keeps existing checkout flow: `POST /api/checkout` with
  `{ plan: 'monthly', propertyId: 'subscription_upgrade' }` then `stripe.redirectToCheckout({ sessionId })`.
  Verified `apps/one/src/app/api/checkout/route.ts` resolves `plan:'monthly'` → `STRIPE_PRICE_MONTHLY`
  and sets `metadata.userId = sessionUser.id` (webhook grants tier). Good.
- Missing Stripe env ⇒ never 500. Today the route returns 500 if `STRIPE_SECRET_KEY` missing; the
  **page** should not crash. Add: if `!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (or a
  `NEXT_PUBLIC_ENABLE_CHECKOUT` flag), render the Pro CTA as a `mailto:` fallback (sales@…, same as
  the agency row) instead of calling `/api/checkout`. Keep the existing try/catch 500-safe.
- `?from=<gate>` highlight: read `useSearchParams()`; if `from` is `compare`/`alerts`/`layouts`, add a
  "brass ring" (e.g. `ring-2 ring-brass` + a small `prov prov--brass` "Recommended for you" tag) to the
  matching Pro feature row / the Pro column header.
- **Agency column:** keep only if `process.env.STRIPE_PRICE_AGENCY` (or `NEXT_PUBLIC_AGENCY_PRICE_ID`)
  is set; otherwise omit the third column (current code always shows it — change to conditional).
- Keep `featured` styling on Pro, `prov--real` "Most Popular" badge.

**Test:** `apps/one/src/app/pricing/page.test.tsx` (jsdom, add `@vitest-environment jsdom`):
- Renders Free + Pro columns; Free shows `2`, Pro shows `4` for compare row (derive from ENTITLEMENTS).
- With `?from=compare` in searchParams, Pro column/compare row carries the brass-ring marker.
- Agency column absent when env unset, present when set (mock `import.meta.env` / `process.env`).
- Pro CTA falls back to `mailto:` when checkout disabled (no `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).

**Risks / open questions:**
- The pricing page is currently a hardcoded `tiers` array. Rewriting to map-driven changes the
  copy/tests; keep the existing Pro feature bullets as static `features` on the Pro column.
- `useSearchParams` in a client component requires a `<Suspense>` boundary in Next 15 App Router for
  static rendering — wrap the client body or mark the page dynamic. Verify build doesn't warn.

---

## Task 5 — Account page "Manage billing" link

**File:** `apps/one/src/app/account/page.tsx` (and extend `account/page.test.tsx`).

Problem: `getSessionUser()` doesn't return `stripe_customer_id`, and `useSessionUser` client hook
mirrors that shape. The portal route needs `stripe_customer_id` (looked up server-side from
`profiles`), but the **account page only shows the link when a sub exists**. Options:

- **Option A (recommended):** extend the `SessionUser` type in `apps/one/src/lib/auth.ts` to include
  `stripeCustomerId: string | null`, have `issueSession`/`verifySession` carry it (add to JWT payload
  + read it back), and have `apps/one/src/app/api/auth/me/route.ts` return it. Then `useSessionUser`
  shape and `account/page.tsx` `SessionUser` interface (line 24-28) gain `stripeCustomerId`. Show the
  "Manage billing →" link only when `user.stripeCustomerId` is truthy. POST to `/api/checkout/portal`.
  - Pro: link visibility is honest (only shows for real subscribers), no extra fetch.
  - Con: changes the JWT claim set — must re-issue sessions; existing cookies without the claim just
    read `undefined` (backward safe).
- **Option B:** add a tiny `GET /api/billing/status` (or extend `auth/me`) that returns
  `{ hasSubscription: boolean }` by querying `profiles.stripe_customer_id`. Account page fetches it in
  the existing `load()` Promise.all. Less invasive to auth/JWT.

Recommend **Option B** (lower blast radius) unless the JWT already needs the claim elsewhere. Plan both;
implement B.

Implementation (Option B):
1. **Create** `apps/one/src/app/api/billing/status/route.ts`:
   `getSessionUser()` → if null 401; else `SELECT stripe_customer_id FROM profiles WHERE id=$1`;
   return `{ hasSubscription: Boolean(stripe_customer_id) }`. Mirror portal route's DB access.
2. **Edit** `account/page.tsx`:
   - Add `interface BillingStatus { hasSubscription: boolean }`.
   - In `load()`, add `fetch('/api/billing/status')` to the Promise.all; store `billing`.
   - Render a "Manage billing →" button (styled like the existing `prov`/link affordances, `text-brass-hi`)
     only when `billing?.hasSubscription`. `onClick` → `POST /api/checkout/portal`, then
     `window.location.href = (await res.json()).url`; handle 400 (no sub) by hiding; 401 → redirect login.
   - Also show current tier badge (already at line 94) — fine.
3. **Extend** `apps/one/src/app/account/page.test.tsx`: mock `/api/billing/status` returning
   `{ hasSubscription: true }` → assert "Manage billing" link/button present; `{ hasSubscription: false }`
   → assert absent.

**Risks / open questions:**
- Is `stripe_customer_id` populated on `profiles` at subscription create? Verify the webhook sets it
  (the webhook syncs `subscription_tier`; confirm it also stores `stripe_customer_id` from the Stripe
  event, else the portal route's 400 will always fire). **Check `webhooks/route.ts` for a
  `stripe_customer_id` write to `profiles`** — if missing, add it (otherwise billing portal is
  unreachable for all users). This is a likely gap; flag as a blocking sub-task.

---

## Task 6 — apps/two layouts `limits` + upgrade line

### 6a. GET /api/layouts returns `limits` — `apps/two/src/app/api/layouts/route.ts:62-76`
- Server already knows `tier` (from `getSessionUser`), `cap` (FREE_CAP/PRO_CAP), and `used`
  (`res.rows.length`). Add to the GET response:
  ```ts
  return NextResponse.json({
    layouts: res.rows,
    limits: { max: cap, used: res.rows.length, tier: user.tier },
  });
  ```
- Keep `FREE_CAP`/`PRO_CAP` as the source (do NOT import from apps/one — separate packages; duplicate
  the numbers or, better, add `LAYOUT_FREE_MAX`/`LAYOUT_PRO_MAX` to a shared `@oper/primitives` or
  `@oper/api-client` consts if one exists). Check `packages/api-client`/`packages/primitives` for an
  existing layouts-const home; if none, keep local caps and just surface them.

### 6b. LayoutBar upgrade line — `apps/two/src/components/Workspace.tsx:LayoutBar` (lines 304-339)
- `LayoutBar` already fetches `/api/layouts` (line 218) into `layouts`. After 6a, the response is
  `{ layouts, limits }` — update the fetch parse to read `data.limits` (and `data.layouts ?? data`).
- When `!canSaveLayout` (free) AND `limits.used >= limits.max`, render an upgrade line at the bar's
  right/end:
  > "5 layouts on the free desk — Pro takes it to 20 →"
  linking `https://one.octavo.press/pricing?from=layouts` (external `Link`/`a`, open in new tab).
  Style with the two-app's existing zinc/amber palette (matches `ScreenTabs.tsx:404-410` free-tier
  banner) — use `text-amber-400` + a `Link` to the one.octavo.press pricing URL.
- If `limits` is absent (old shape / test), fall back to `layouts.length` for `used` and `FREE_CAP` for
  `max` so the bar never crashes.
- `canSaveLayout` is already `isPro` (TerminalClient.tsx:566) so free users already can't save; this
  only adds the honest "you're at the cap" nudge.

### 6c. Test (apps/two — needs setup)
- `apps/two` has **no vitest config and no tests**. To satisfy "component test", either:
  - **(a)** Add `apps/two/vitest.config.ts` (alias `@`→`src`, `environmentMatchGlobs` jsdom like
    apps/one) + `vitest` devDep, then write `apps/two/src/components/LayoutBar.test.tsx` mocking
    `fetch('/api/layouts')` to return `{ layouts:[…5], limits:{max:5,used:5,tier:'free'} }` and asserting
    the upgrade line + link render; and a `used<max` case asserting it's absent.
  - **(b)** If standing up vitest in `two` is out of scope, rely on `typecheck` + a manual checklist and
    note the gap. Recommend (a) for parity with `one`.
- Risk: `two` uses `cn`/`useHotkey` from `@oper/primitives`; jsdom test must not break on hotkey
  listeners (they're no-ops without a global handler). Verify `LayoutBar` renders without router context
  (it's a plain component, no `next/link` currently — add `Link` from `next/link` or a raw `<a>` for the
  external URL; raw `<a target="_blank">` is simplest and avoids next router in tests).

---

## Cross-cutting notes

- **Single source for caps:** compare caps live in `apps/one/src/lib/entitlements.ts`; layout caps live
  in `apps/two/src/app/api/layouts/route.ts` (surfaced, not imported cross-package). Do NOT create a
  cross-app import for layouts.
- **Honesty principle:** every gate keeps the user's data visible (first N rows, selections, saved
  layouts) and shows UpgradeMoment rather than blanking or silently truncating.
- **No new secrets / no Mapbox tokens** — pricing fallback uses existing `mailto:` pattern.
- **Run before done:** `pnpm --filter @oper/one test && pnpm --filter @oper/one typecheck` and
  `pnpm --filter @oper/two typecheck` (plus `two` test if 6c(a) done). `pnpm lint` on touched files.

## Open questions / risks to confirm during build
1. Does `webhooks/route.ts` write `stripe_customer_id` to `profiles`? If not, Task 5 portal is
   unreachable for everyone — blocking. (Likely needs a fix.)
2. Is `shelf/page.tsx` `selected` capped by `useCompare` or independent? Affects Task 3c gate.
3. Does `apps/two` get a vitest setup (Task 6c)? Affects test coverage there.
4. Pricing page `useSearchParams` Suspense boundary for `?from=` — confirm Next build is clean.
5. JWT claim addition (Option A) vs new `/api/billing/status` (Option B) — recommend B, lower blast radius.
