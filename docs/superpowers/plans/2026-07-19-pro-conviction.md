# Pro Conviction — Honest Pricing, Upgrade Moments, Billing Loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pro worth paying for at the exact second the user feels the limit. Real pro differentiators now exist in the product — instant deal alerts (free waits for the daily digest), terminal saved-layout caps (5 free / 20 pro), the compare cap (`COMPARE_FREE_MAX`) — but the pricing page predates all of them, the caps fail silently or with dead-end errors, and there is no billing portal. This plan turns every cap into an upgrade moment with one shared component, rewrites the pricing page around the real feature matrix, and closes the Stripe loop (checkout → webhook tier sync → customer portal).

**Architecture:** One `UpgradeMoment` component (apps/one) + its terminal twin (apps/two) renders the paywall copy for a named `gate` (compare/alerts/layouts) and deep-links to checkout with `?from=<gate>` attribution. A single `ENTITLEMENTS` map (shared constants in `apps/one/src/lib/entitlements.ts`, mirrored to two via its API responses — not a cross-app import) becomes the one source of caps. Stripe: the existing session-derived checkout gains a `billing_portal` route; the webhook handler (verify it exists; Wave-5 era) syncs `subscription_tier` on subscription events and is the only writer of that column.

**Tech Stack:** apps/one + apps/two (Next 16), existing Stripe integration (session-derived checkout, `stripe_customer_id`, `subscription_tier` on profiles), Vitest.

## Global Constraints

- **`profiles.subscription_tier` is written ONLY by the Stripe webhook path** (or an explicit admin script). No client-reachable route may set tier.
- **Caps live in ONE place per app**: `ENTITLEMENTS` in apps/one; apps/two receives its caps from its own API (`/api/layouts` already enforces 5/20 server-side — the client reads the cap from a `limits` field added to that API's GET response, never hardcodes it).
- **Fail-open honesty:** if Stripe env is missing (`STRIPE_SECRET_KEY`/price IDs), upgrade CTAs render but land on `/pricing` with a "checkout coming online" note — never a 500, never a fake checkout.
- **No dark patterns:** every UpgradeMoment names the free alternative in plain copy ("Daily digest stays free").
- **Server enforces, client explains.** All caps must already be (or become) server-enforced; the UI layer only communicates.
- **Design language:** eggshell tokens; brass is the upgrade accent (existing convention).
- **Tests:** Vitest per app; jsdom pragma for TSX.

## Current State (verified 2026-07-18 on prod + code, some Wave-5 memory — implementers re-verify in Task 1)

- Tiers: `profiles.subscription_tier` (`free`… `pro` checked as `=== 'pro'` in compare + layouts). Stripe checkout is session-derived and LIVE (Wave-5 wrap-up: real `cs_test` session created; agency-tier 400s until its price ID exists). `stripe_customer_id` on profiles.
- Real gates today: `/compare` free cap `COMPARE_FREE_MAX` (page errors past it), `/api/layouts` 5 free / 20 pro (server-side), alerts instant-vs-daily (worker tier split). None render an upgrade path.
- `/pricing` page exists (brass affordance in nav) — content predates alerts/layouts/compare features and the per-tier price-ID fix noted in Wave-5 ("pricing-page per-tier fix, checkout inert until then").
- Webhook: Wave-5 mentions checkout + Stripe wiring; the webhook's existence/route and whether it writes `subscription_tier` is UNVERIFIED — Task 1 audits it. There is a `stripe_webhook_dlq` table in the DB (seen in role-grant listings), implying a handler exists.
- No billing portal route anywhere (grep `billing_portal` = 0).

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/lib/entitlements.ts` (create) | `ENTITLEMENTS = { free: {compareMax, layoutsMax, alerts: 'daily'}, pro: {...} }` + `entitlementsFor(tier)`. |
| `apps/one/src/components/UpgradeMoment.tsx` (create) | The paywall card: gate-specific copy, free-alternative line, checkout link with `?from=`. |
| `apps/one/src/app/compare/page.tsx` (modify) | Cap error → UpgradeMoment. |
| `apps/one/src/components/AlertsBell.tsx` (modify) | Free tier sees "instant with Pro" line in the dropdown footer. |
| `apps/one/src/app/pricing/page.tsx` (rewrite) | Honest matrix from `ENTITLEMENTS`; per-tier price IDs; env-missing fallback. |
| `apps/one/src/app/api/billing/portal/route.ts` (create) | Session → Stripe customer portal redirect. |
| Stripe webhook route (audit/modify, located in Task 1) | Subscription events sync `subscription_tier`; DLQ preserved. |
| `apps/two/src/app/api/layouts/route.ts` (modify) | GET gains `limits: {max, used, tier}`. |
| `apps/two/src/components/…LayoutBar` (modify) | Cap reached → terminal-idiom upgrade line (links to one's /pricing). |

---

## Task 1: Stripe truth audit + entitlements map

**Files:** create `apps/one/src/lib/entitlements.ts` + test; audit report appended to this plan file's Decisions section.

- [ ] **Step 1: Audit (read-only, written up in the report):** locate the checkout route + webhook route; confirm (a) which Stripe events the webhook handles, (b) whether it writes `subscription_tier`, (c) DLQ behavior, (d) which price-ID env vars exist on the server (`grep STRIPE_ /etc/oper.env` names only — values never leave the box). If the webhook does NOT sync tier: implementing that sync (checkout.session.completed + customer.subscription.updated/deleted → tier by price ID, via the DLQ-guarded path) becomes part of Task 4's scope — record the finding either way.
- [ ] **Step 2: TDD the map:** `entitlementsFor('free')` → `{compareMax: <the real COMPARE_FREE_MAX value — read it from the compare page/config and import-or-move the constant so there is ONE definition>, layoutsMax: 5, alerts: 'daily'}`; `entitlementsFor('pro')` → `{compareMax: Infinity, layoutsMax: 20, alerts: 'instant'}`; unknown tier → free.
- [ ] **Step 3: Replace scattered constants** — compare page + anywhere else reading `COMPARE_FREE_MAX` imports from `entitlements.ts` now. Suite + typecheck; commit — `feat(billing): single entitlements map + Stripe truth audit`

## Task 2: UpgradeMoment + gate integrations (apps/one)

- [ ] **Step 1: TDD the component** (jsdom): `<UpgradeMoment gate="compare" />` renders the gate headline ("Compare more than {free.compareMax} side by side"), the free-alternative line, and an anchor to `/pricing?from=compare`; `gate="alerts"` variant says "Instant alerts" + "Daily digest stays free".
- [ ] **Step 2: Integrate:** compare page's over-cap error branch renders it (keep the first `compareMax` items visible behind it — don't blank the page); AlertsBell dropdown footer shows the alerts variant for free users (one line, dismiss-less, quiet); shelf's compare bar disables past-cap selection with a tooltip naming the cap.
- [ ] **Step 3: Suite + typecheck; commit** — `feat(billing): upgrade moments at compare + alerts gates`

## Task 3: Pricing page rewrite

- [ ] **Step 1:** Rebuild `/pricing` from `ENTITLEMENTS`: two columns (Free / Pro), rows generated from the map (compare, layouts, alerts cadence) plus the static truths (search, calculators, index). Pro column CTA = the existing session-derived checkout with the pro price ID; `?from=` lands highlighted on the matching row (small brass ring). Missing Stripe env → CTA renders `Checkout coming online — email us` mailto (constraint: never 500). Agency column only if its price ID exists (Wave-5: it 400s — hide until env provides it).
- [ ] **Step 2:** jsdom test: rows reflect the map values (change the map, the page follows); `?from=alerts` highlights the alerts row.
- [ ] **Step 3: Suite + typecheck; commit** — `feat(billing): pricing page generated from the entitlements map`

## Task 4: Billing loop — portal + webhook tier sync

- [ ] **Step 1: Portal route** (`/api/billing/portal`): session user → look up `stripe_customer_id` → create a Stripe billing-portal session → 303 redirect; 401 signed out; 409 with a friendly body when the user has no customer id (never bought). Route test with a mocked Stripe client (follow the checkout route's existing mock pattern).
- [ ] **Step 2: Webhook tier sync** (scope per Task 1's audit): ensure `checkout.session.completed` + `customer.subscription.updated` + `customer.subscription.deleted` map price ID → `subscription_tier` (`pro`→'pro', delete→'free') through the existing signature-verified, DLQ-guarded handler. Idempotent (event replay safe — tier writes are absolute, not incremental). Tests: each event fixture → expected UPDATE; bad signature → DLQ path untouched.
- [ ] **Step 3: Account page** gains a "Manage billing →" link (posts to the portal route) shown only when `stripe_customer_id` exists.
- [ ] **Step 4: Suite + typecheck; commit** — `feat(billing): customer portal + webhook tier sync`

## Task 5: Terminal caps speak (apps/two)

- [ ] **Step 1:** `/api/layouts` GET response gains `limits: { max, used, tier }` (server already knows all three; add + route test).
- [ ] **Step 2:** The layout bar, at `used >= max` for free tier, renders the terminal-idiom line "5 layouts on the free desk — Pro takes it to 20 → " linking `https://one.octavo.press/pricing?from=layouts` (the terminal has no checkout of its own; keep it a plain link). Component test.
- [ ] **Step 3: two suite + typecheck; commit** — `feat(two): layout cap surfaces the upgrade path`

## Task 6: Deploy + revenue-path proof

- [ ] Build one + two; restart `oper-app`, `oper-two`.
- [ ] **Gate proofs:** free user at compare cap sees the UpgradeMoment with the first N still visible; `/pricing?from=compare` highlights the compare row; terminal at 5 layouts shows the upgrade line; AlertsBell footer shows the instant-with-Pro line for free tier.
- [ ] **Billing proofs (Stripe test mode):** checkout completes → webhook flips tier to `pro` (DB check) → the same gates now pass (compare uncapped, layouts 20, alerts instant on next tick) → portal link opens the Stripe portal → cancel in portal → webhook returns tier to `free`.
- [ ] **Fail-open proof:** with price-ID env removed on a staging run of the page (or a forced flag), the pricing CTA renders the fallback, no 500s.

## Self-Review

**Spec coverage:** upgrade moment at every real gate (T2, T5) · honest pricing generated from one map (T1, T3) · complete billing loop incl. portal + tier sync + downgrade (T4, T6 proof) · server-enforces/client-explains + single-writer tier + fail-open constraints carried throughout. Covered.

**Placeholder scan:** the two located-at-execution items (webhook route + checkout constants) are explicit audit steps with their findings feeding later tasks; all other steps name exact files and assertable tests.

**Type consistency:** `ENTITLEMENTS`/`entitlementsFor` defined once (T1) and consumed by compare/pricing/UpgradeMoment (T2-T3); two's caps flow through its API `limits` field (T5), never a cross-app import; `subscription_tier` values (`free`/`pro`) match the existing checks (`=== 'pro'`) everywhere.
