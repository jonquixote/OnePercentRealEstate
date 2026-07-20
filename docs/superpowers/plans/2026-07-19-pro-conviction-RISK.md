# Pro Conviction — Independent Risk / Audit Report

**Date:** 2026-07-19
**Branch:** `pro-conviction` (tracking `origin/main`)
**Scope:** Second-opinion audit of the "Pro Conviction" feature against the plan
(`docs/superpowers/plans/2026-07-19-pro-conviction.md`). Read-only — no code written.

---

## 0. Executive summary

The plan assumes the webhook tier-sync and billing portal "do not exist and must be
built." **Reality contradicts that premise on both counts.** A webhook handler already
exists and writes `subscription_tier`, and a billing-portal route already exists. The
real risks are therefore NOT "missing pieces" but **correctness gaps in code that is
already live**: price→tier mapping is status-based (not price-based), an agency tier is
advertised but will silently downgrade to `pro`, the account page has no billing link,
`stripe_customer_id` is never surfaced to the client, and the schema has a contradictory
tier definition (`'enterprise'` in `schema.sql` vs. `('free','pro')` CHECK in
`000_base_schema.sql`). Tests cannot run in this worktree (`node_modules` absent).

---

## 1. Plan-vs-reality deltas

| Plan assumption | Reality (verified by reading code) | File |
|---|---|---|
| "webhook does NOT sync tier — build it" | Webhook **already** writes `subscription_tier` on `checkout.session.completed`, `customer.subscription.updated/deleted`. | `apps/one/src/app/api/webhooks/route.ts:7-127` |
| "No billing portal route anywhere (grep `billing_portal` = 0)" | Billing-portal route **already exists** at `/api/checkout/portal`. | `apps/one/src/app/api/checkout/portal/route.ts` |
| Single writer = webhook only | Webhook IS the only writer reachable today (see §4), but the plan's Task 4 narrative ("ensure webhook tier sync") should be reframed as **fix/verify**, not **build**. | — |
| "agency-tier 400s until price ID exists" | `STRIPE_PRICE_AGENCY` is read in checkout (`route.ts:14`) but **not declared** in `env.ts` (only `MONTHLY`/`ANNUAL` exist, lines 17-18). It will always be `undefined` → agency plan 400s. Consistent with plan, but the env contract is undocumented. | `apps/one/src/lib/env.ts:14-18` |

**Implication:** Task 4's framing ("build the sync") understates the work. The work is
**correctness hardening** of an already-shipping handler. Treat Task 1's audit as
"confirm the handler is correct," and the finding is: it is not fully correct (§2).

---

## 2. Correctness risks in existing webhook / checkout / portal

### 2.1 Webhook maps tier by *status*, not *price id* (HIGH)
`handleSubscriptionUpdated` sets `subscription_tier = 'pro'` for `active`/`trialing` and
`'free'` otherwise — driven purely by `subscription.status` (`route.ts:73-94`). The plan
explicitly requires mapping by **price id** (`checkout.session.completed` + subscription
events → tier by price ID). Consequences:

- If an **agency** price ever produces a `pro`/`trialing` status, the webhook will set
  `subscription_tier = 'pro'` — collapsing agency→pro. The `subscription_tier` CHECK only
  allows `('free','pro')` (`000_base_schema.sql:181`), so agency can never be represented
  anyway. **The pricing page advertises an Agency tier that the data model cannot store.**
- If a customer is in `past_due` or `paused`, they are flipped to `free` immediately —
  losing entitlements before dunning completes. Whether that is intended is undecided;
  `paused` especially should arguably retain `pro` until cancellation.

### 2.2 `checkout.session.completed` user resolution is fragile / over-engineered (MEDIUM)
`handleCheckoutSessionCompleted` (`route.ts:7-71`):

- It resolves the user via `metadata.userId`, but only if that user *already* has a
  *different* `stripe_customer_id` (`route.ts:19-32`). The owner-check logic:
  `WHERE id=$1 AND stripe_customer_id IS NOT NULL AND stripe_customer_id <> $2`. This
  means a brand-new customer (no `stripe_customer_id` yet) **fails the owner check**
  because `stripe_customer_id IS NOT NULL` is false → `resolvedUserId` stays null → falls
  through to **email lookup**, then to **inserting a NEW profile with a random UUID**
  (`route.ts:44-55`). For a normal first-time subscriber this creates a *second, orphaned
  profile* rather than attaching to the signed-in account. The checkout route does pass
  `metadata.userId` (`checkout/route.ts:84`), so the happy path should resolve by id — but
  the `IS NOT NULL` predicate defeats it for first purchases.
- Net effect: first-time buyers may get a duplicate `profiles` row with a fresh `id`,
  and their original session user stays `free`. **This is a real entitlement-loss bug,
  not theoretical.** Recommendation: resolve by `metadata.userId` directly against
  `profiles.id` (ignore the `stripe_customer_id IS NOT NULL` guard), then UPSERT
  `stripe_customer_id`.

### 2.3 Idempotency is event-id based but tier writes are per-customer (LOW/MEDIUM)
The `stripe_webhook_events` table dedupes by event id (`route.ts:159-185`). Replays of the
same event are correctly skipped. Absolute (non-incremental) tier writes are replay-safe.
OK. But the `customer.subscription.deleted` path writes `free` — if it arrives *after* a
later `customer.subscription.updated` (out-of-order delivery), the final state is
order-dependent. Stripe generally orders these, but the handler does **not** guard
against an older `deleted` overwriting a newer `updated`. Low likelihood; note it.

### 2.4 Portal route status codes diverge from the plan (MEDIUM)
Plan (Task 4) says: 401 signed out; **409 friendly** when no customer id. Reality:
- Missing `STRIPE_SECRET_KEY` → **500** (`portal/route.ts:7-9`). Plan's fail-open
  constraint says upgrade CTAs must never 500 on missing env. The *page* fails open (see
  §4), but a direct POST to this route 500s. Inconsistent with the global constraint.
- No customer id → **400** (`portal/route.ts:29-31`), not 409. Plan says 409. Minor, but
  the account-page client must match whatever is shipped.

### 2.5 Portal returns JSON `{url}`, not a 303 redirect
Plan says "303 redirect". Route returns `NextResponse.json({ url })` (`portal/route.ts:42`).
The client must then `window.location = url`. Acceptable if the account page handles it,
but it is not a redirect — document the contract.

---

## 3. Missing session fields (`stripe_customer_id`)

- `getSessionUser()` returns only `{ id, email, tier }` (`auth.ts:29-33`). It does **not**
  expose `stripe_customer_id`. `issueSession`/`verifySession` only encode `email`+`tier`
  (`auth.ts:38-56`).
- The account page renders tier from `GET /api/auth/me` (`account/page.tsx:40-45`),
  which returns the raw `SessionUser` — also no `stripe_customer_id`
  (`auth/me/route.ts:1-8`).
- **Gap:** The plan (Task 4, Step 3) wants a "Manage billing →" link shown *only when
  `stripe_customer_id` exists*. Neither the session nor `/api/auth/me` surfaces it. The
  account page cannot conditionally render the link without either (a) a new field on the
  session / `/api/auth/me`, or (b) an extra DB query in the account page. **Flag: add
  `stripe_customer_id` to the session payload and `/api/auth/me` response**, or have the
  account page query it directly. The portal route itself reads it server-side fine
  (`portal/route.ts:20-24`); only the *client visibility* is missing.

---

## 4. Single-writer / fail-open violations

### 4.1 Single-writer constraint — SATISFIED today, with one caveat
Grep for all `subscription_tier` writes across `apps/one`, `apps/two`, `apps/worker`,
migrations:

- Writers of `subscription_tier`:
  - `apps/one/src/app/api/webhooks/route.ts:46-66, 98-103` (webhook only) ✅
  - `infrastructure/000_base_schema.sql:180` (default `'free'`) ✅
  - `services/create_profile.py:16` (admin/seed script) ✅
  - `schema.sql:11` (Supabase legacy enum default — **see §4.3 contradiction**)
- **No client-reachable route other than the webhook sets tier.** `auth/login` and
  `auth/signup` only *read* `subscription_tier` to derive the session (`login/route.ts:25-36`,
  `signup/route.ts:38-45`). `v1/listings` only reads (`route.ts:83-86`). `properties/route.ts`
  only reads. ✅
- **Constraint HOLDS.** Good. The plan's central invariant is currently enforced.

### 4.2 Fail-open — pricing page OK; portal route 500s (MEDIUM)
- Pricing page: `handleCheckout` sends to `/api/checkout`. If `STRIPE_SECRET_KEY` is
  missing, checkout returns 500, the `catch` sets `error` state (`pricing/page.tsx:111-113`)
  — the page does **not** 500, it shows an error string. Acceptable, but it is *not* the
  "Checkout coming online — email us" mailto fallback the plan requires (Task 3, Step 1).
  Today a missing-price env (e.g. `STRIPE_PRICE_MONTHLY` unset) yields a 400 from
  checkout → error string "Checkout failed…". **The plan's explicit mailto fallback is not
  implemented.** Flag.
- `/api/checkout/portal` 500s on missing `STRIPE_SECRET_KEY` (`portal/route.ts:7-9`) —
  violates the global "never 500 on missing env" constraint. Should return a friendly
  body so the account page can hide/disable the billing link gracefully.

### 4.3 Schema tier definition CONTRADICTION (HIGH, silent)
- `infrastructure/000_base_schema.sql:180-181`:
  `subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free','pro'))`
- `schema.sql:5`: `CREATE TYPE subscription_tier AS ENUM ('free','pro','enterprise')`
- These two are mutually inconsistent (TEXT+CHECK vs ENUM with `enterprise`). The
  checkout/webhook code only ever uses `free`/`pro`, and the DB CHECK would *reject*
  `enterprise`. Yet the **pricing page advertises an Agency/enterprise tier**
  (`pricing/page.tsx:46-61`) and `VALID_PRICE_IDS.agency` exists (`checkout/route.ts:14`).
  Even if `STRIPE_PRICE_AGENCY` is set, a successful agency checkout would either (a) hit
  the CHECK and fail to write tier, or (b) set `pro` and silently mislabel the customer.
  **The Agency tier is non-functional end-to-end.** Plan Task 3 says "Agency column only
  if its price ID exists" — but even then it cannot be honored. Flag as a blocker for any
  agency launch; for Pro Conviction (free/pro only) it is a documentation/honesty gap.

---

## 5. Entitlements duplication / drift risk

| Cap | Definition site(s) | Drift risk |
|---|---|---|
| `COMPARE_FREE_MAX` | `useCompare.tsx:11` (=2), `properties/route.ts:11` (=2), plan references it | **3 sites.** `useCompare.tsx` and `properties/route.ts` both hardcode `2`; `page.tsx` imports from `useCompare`. The API (`properties/route.ts`) is the enforcement source but duplicates the constant. Plan Task 1 correctly calls for ONE map. |
| `COMPARE_MAX` / `COMPARE_PRO_MAX` | `useCompare.tsx:10` (=4), `properties/route.ts:12` (=4) | Duplicated; must be unified into `ENTITLEMENTS`. |
| Layouts cap | `apps/two/src/app/api/layouts/route.ts:22-23` (`FREE_CAP=5`, `PRO_CAP=20`) | Server-enforced only; client (terminal) must read from the new `limits` field (Task 5). Currently the cap is **not** in the GET response at all — `GET` returns raw rows only (`layouts/route.ts:62-76`). **Must add `limits` before the terminal can show the upgrade line.** |
| Alerts cadence | worker `alerts.ts:429` (`!== 'pro' → daily`) | Driven by `subscription_tier`, single-sourced. OK. |

**Drift risk is real and acknowledged by the plan; the fix (single `ENTITLEMENTS` map +
API `limits` field) is the right call.** Note `properties/route.ts` must import from the
new map, not just `useCompare.tsx` (which is a `'use client'` module — importing a client
hook into a route handler is wrong; the constant must live in a non-client module like
`lib/entitlements.ts`).

---

## 6. Test baseline status

- `apps/one` `package.json` defines `"test": "vitest run"` (`apps/one/package.json:13`).
- `apps/two` `package.json` has **no `test` script** (`apps/two/package.json:5-11`) — only
  `dev/build/start/lint/typecheck`. Vitest is **not** a dependency of `two` at all
  (`apps/two/package.json:12-45` lists no `vitest`/`jsdom`). **Task 5's "component test"
  and "route test" for `apps/two` cannot run as-is** — `vitest` + `jsdom` +
  `@testing-library/react` must be added to `two`'s deps/devDeps and a `vitest.config.ts`
  created (mirroring `apps/one/vitest.config.ts`, which sets `environmentMatchGlobs` to
  `jsdom` for `*.test.tsx`).
- `apps/one/vitest.config.ts` correctly sets `environment: 'node'` + `environmentMatchGlobs:
  [['**/*.test.tsx','jsdom']]` ✅ — the jsdom pragma the plan requires is already wired.
- **Cannot execute tests in this worktree:** `node_modules` is absent at root and in
  `apps/one` (`pnpm install` not run; `pnpm -C apps/one test` → `vitest: command not
  found`). Baseline status: **UNVERIFIED — install required before any `pnpm test` will
  run.** No test results to report; no existing billing/webhook tests found in tree.

---

## 7. Recommended ordering of the 6 work items (with dependencies)

```
T1  Stripe truth audit + ENTITLEMENTS map
    ├─ Depends on: nothing (read-only audit + new constants module)
    ├─ Unblocks: T2, T3, T5 (all consume the map)
    └─ MUST also: fix the schema contradiction (§4.3) decision — either drop
       'enterprise' from schema.sql or widen the CHECK; decide before T3 ships
       the Agency column.

T2  UpgradeMoment + gate integrations (apps/one)
    └─ Depends on: T1 (ENTITLEMENTS + compareMax import)

T3  Pricing page rewrite
    ├─ Depends on: T1 (ENTITLEMENTS)
    └─ BLOCKED by schema decision (§4.3) if Agency column is kept; implement the
       mailto fail-open fallback (§4.2) that is currently missing.

T4  Billing loop — portal + webhook tier sync   [REFRAME: fix/verify, not build]
    ├─ Depends on: T1 (audit findings)
    ├─ MUST FIX:
    │    • 2.1 price→tier mapping (status today; plan wants price-id)
    │    • 2.2 checkout.session.completed orphan-profile bug (first-time buyers)
    │    • 2.4 portal 409-not-400 + no-500-on-missing-env
    │    • 3   expose stripe_customer_id on session + /api/auth/me
    └─ Adds account-page "Manage billing" link (needs §3 fix first)

T5  Terminal caps speak (apps/two)
    ├─ Depends on: T1 (cap values)
    ├─ BLOCKED until: vitest/jsdom/@testing-library added to two (§6)
    └─ MUST: add `limits:{max,used,tier}` to GET /api/layouts (currently absent)

T6  Deploy + revenue-path proof
    └─ Depends on: T1–T5 all green; staging fail-open run (§4.2)
```

**Critical-path note:** T1's audit output must explicitly record the §2.1/§2.2 webhook
defects, because T4's scope (currently written as "ensure sync exists") is actually
"repair an already-shipping, partially-broken sync." The orphan-profile bug (§2.2) is the
highest-severity issue in the whole feature and should be fixed before any real checkout
traffic relies on it.

---

## 8. One-paragraph summary

The plan's core premise — that the webhook tier-sync and billing portal must be built
from scratch — is false: both already exist and the single-writer invariant (webhook-only
tier writes) is correctly enforced today. The real risk is in *correctness of live code*,
not missing scaffolding: the webhook derives tier from subscription **status** rather than
**price id** (so an agency purchase collapses to `pro`, and `paused`/`past_due` customers
lose entitlements prematurely); `checkout.session.completed` creates a **duplicate orphan
profile** for first-time buyers because its owner-check requires a pre-existing
`stripe_customer_id`; the `stripe_customer_id` is never exposed to the client so the
account page cannot conditionally show a billing link; the schema contradicts itself
(`'enterprise'` in `schema.sql` vs `('free','pro')` CHECK) making the advertised Agency
tier unstoreable; the pricing page lacks the required mailto fail-open fallback and the
portal route 500s on missing env; and `apps/two` has no test tooling at all, blocking Task
5's tests. Tests could not be executed in this worktree (`node_modules` absent). Highest
priority fix before any paid traffic: the checkout webhook orphan-profile bug.
