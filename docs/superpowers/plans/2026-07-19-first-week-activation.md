# First-Week Activation — Onboarding Wizard, Live Email, Warm Empty States

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn shipped machinery into used machinery. The deal-alert engine, investor presets, saved properties, and the shelf are all live — and almost nobody feeds them: `alert_events` is empty because no user has watched areas, alert email is dark behind `RESEND_API_KEY`, and a fresh signup lands on a page with no path into any of it. This plan adds a 60-second post-signup onboarding wizard (areas → strategy → rates → alert opt-in), wires the email leg end-to-end behind one env var, and converts the app's dead-end empty states into paths that seed prefs/saves.

**Architecture:** A 3-step client wizard (`/welcome`) writes through the existing validated `/api/prefs` PUT — no new storage. Signup redirects there once (`profiles.prefs->>'onboarded'` guard, stored inside the existing jsonb — no migration). The alert/digest email leg reuses the digest worker's existing send helper; a single `sendAlertEmail` template renders the deal card. Empty states (shelf sections, alerts bell, search "my areas") each gain one CTA into the wizard or the relevant action.

**Tech Stack:** Next 16 App Router (apps/one), existing session auth + `/api/prefs` (`parsePrefs`), `apps/worker/src/alerts.ts` fanout, the digest worker's Resend send path, Vitest (jsdom pragma for TSX).

## Global Constraints

- **No new tables, no migration.** `onboarded: true` and everything the wizard writes live inside `profiles.prefs` via the existing `parsePrefs`-validated PUT (extend `InvestorPrefs` with the optional flag; `parsePrefs` must keep accepting older blobs without it).
- **Session identity only**; the wizard is unreachable signed-out (redirect to sign-in with `?next=/welcome`).
- **Email stays owner-gated**: absent `RESEND_API_KEY` ⇒ in-app only, zero errors, a single boot-time log line (the digest worker's existing pattern). No new email dependency — reuse its client/helper.
- **The wizard is skippable at every step** ("Skip for now" → marks `onboarded` true with whatever was completed). Never trap the user.
- **Design language:** eggshell tokens + `.prov/.mat/.figure`; the wizard reuses `METROS` chips and the account page's existing preset inputs (import/share components — do not fork copies).
- **Alert dedup invariant unchanged** (UNIQUE user+listing); the email leg only flips `delivered_at`.
- **Tests:** `pnpm --filter @oper/one test <path>`, `pnpm --filter @oper/worker test <path>`.

## Current State (verified 2026-07-18 on prod + code)

- `profiles.prefs jsonb` live; `/api/prefs` GET/PUT validated via `parsePrefs` (`apps/one/src/lib/prefs.ts`, clamp table + `areas[{label,zip}]`); account page has a working presets editor (`#presets`).
- Alert tick live (`oper-worker-alerts`, 5-min tick, log: `candidates:26, eventsInserted:0` — zero users have areas). Fanout: pro instant / free waits for digest; `delivered_at` stamps on send. In-app bell exists (`AlertsBell`), `/api/alerts` inbox works (401 signed out).
- Digest worker (`apps/worker/src/digest.ts`, runs via tsx) already contains the Resend-gated send helper and the `RESEND_API_KEY`-absent no-op pattern — the helper to reuse.
- Signup flow: self-owned session auth (Wave 5); post-signup redirect target is where the wizard hooks in (find the signup success handler under `apps/one/src/app/api/auth/*` or the signup page's client redirect — Task 2 locates and threads it).
- Empty states today: shelf sections say "Save a property from any card — the ♥" (no link); AlertsBell empty text has no CTA; search page shows "My areas" chips only when prefs.areas is non-empty (nothing tells you they exist).

## File Structure

| File | Responsibility |
|---|---|
| `apps/one/src/app/welcome/page.tsx` (create) | The 3-step wizard (areas → strategy+rates → alerts opt-in + finish). |
| `apps/one/src/components/onboarding/WizardSteps.tsx` (create) | Pure step components consuming the account page's shared preset inputs. |
| `apps/one/src/lib/prefs.ts` (modify) | `InvestorPrefs` gains `onboarded?: boolean`, `alertOptIn?: boolean`; clamps unchanged. |
| signup redirect site (modify, located in Task 2) | New users → `/welcome` once. |
| `apps/worker/src/alert-email.ts` (create) | `renderAlertEmail(events, listings)` pure template + `sendAlertEmails` using the digest's send helper. |
| `apps/worker/src/alerts.ts` (modify) | Instant fanout calls `sendAlertEmails` for pro users with `alertOptIn`. |
| `apps/one/src/app/shelf/page.tsx`, `AlertsBell.tsx`, search page (modify) | Empty-state CTAs into `/welcome` / save actions. |

---

## Task 1: Prefs schema additions (pure)

**Files:** modify `apps/one/src/lib/prefs.ts` + `prefs.test.ts`

- [ ] **Step 1: Failing tests** — `parsePrefs({})` still yields defaults with `onboarded: false`, `alertOptIn: false`; `parsePrefs({onboarded: true, alertOptIn: true})` round-trips; junk values (`onboarded: 'yes'`) coerce to boolean via `=== true`.
- [ ] **Step 2: RED → implement → GREEN.** Add both optional booleans to `InvestorPrefs` + `DEFAULT_PREFS` (`false`) + coercion in `parsePrefs` (`onboarded: raw?.onboarded === true` pattern). Nothing else changes.
- [ ] **Step 3: Commit** — `feat(user): prefs gain onboarded + alertOptIn flags`

## Task 2: The wizard + signup hook

**Files:** create `apps/one/src/app/welcome/page.tsx`, `apps/one/src/components/onboarding/WizardSteps.tsx` (+ test); modify the signup redirect site.

- [ ] **Step 1: Locate the redirect site** — grep the signup success path (`apps/one/src/app/api/auth` + the signup page component). Thread: on successful signup, client-redirect to `/welcome`. Existing users signing IN are untouched.
- [ ] **Step 2: Failing wizard test** (jsdom): renders step 1 with the 8 `METROS` chips; selecting two chips + Next → step 2 shows rate/down inputs (defaults from `DEFAULT_PREFS`); Next → step 3 has an "Email me instant deals" toggle (pro copy notes tier); Finish fires `usePrefs().save` with `{areas: [2 picked], onboarded: true, alertOptIn: <toggle>}`; "Skip for now" on any step saves `onboarded: true` with whatever's accumulated and routes to `/search`.
- [ ] **Step 3: Implement.** Wizard state local; single `save` on finish/skip (one PUT). Steps reuse the account page's preset inputs (extract them to `components/onboarding/` shared form pieces ONLY if they aren't already importable — prefer importing what exists; do not duplicate the clamp logic, `parsePrefs` owns it). Signed-out → redirect `/account?next=/welcome` (or the auth page path used elsewhere — match convention). After finish: route to `/search` — the "My areas" chips will now be populated, which is the payoff moment.
- [ ] **Step 4: Guard** — `/welcome` when `prefs.onboarded` is already true → gentle "You're set up" screen with links to `/account#presets` + `/search` (no redirect loop).
- [ ] **Step 5: Full one suite + typecheck; commit** — `feat(user): 60-second onboarding wizard — areas, rates, alert opt-in`

## Task 3: Alert email leg

**Files:** create `apps/worker/src/alert-email.ts` + `alert-email.test.ts`; modify `apps/worker/src/alerts.ts` (+ its test).

- [ ] **Step 1: Failing tests** — `renderAlertEmail` (pure): given 2 events with listing rows (address, price, rent, ratio fraction, photo url, property id), returns `{subject, html}` where subject names the first area label + count ("New deal in Houston (+1 more)"), html contains both addresses, the ratio as a percent (2 decimals), absolute `https://one.octavo.press/property/<id>` links, and an unsubscribe href built from the digest's existing unsubscribe helper (import it; do not hand-roll tokens). No `<script>`, no external CSS.
- [ ] **Step 2: RED → implement → GREEN.** Then wire: in `alerts.ts` instant fanout, for pro users whose prefs blob has `alertOptIn === true` (the tick already loads profiles/prefs for area matching — reuse that row, don't re-query), call `sendAlertEmails` (which no-ops without `RESEND_API_KEY`, logging once at module init like digest). `delivered_at` semantics unchanged: stamp on successful send OR on in-app-only fanout exactly as today (email failure must not lose the in-app event — wrap send in try/catch, log warn).
- [ ] **Step 3: Worker suite + typecheck; commit** — `feat(worker): instant alert emails (Resend-gated, opt-in, dedup-safe)`

## Task 4: Warm empty states

**Files:** modify `apps/one/src/app/shelf/page.tsx`, `apps/one/src/components/AlertsBell.tsx`, `apps/one/src/app/search/page.tsx` (+ tests where those files have them).

- [ ] **Step 1:** Shelf: "Saved properties" empty state gains `Browse deals →` (`/search`); "Watched searches" empty state gains `Set up your areas →` (`/welcome`); presets teaser shows "Not set up yet — 60 seconds →" (`/welcome`) when `!prefs.onboarded`.
- [ ] **Step 2:** AlertsBell empty dropdown: "Alerts land here when a deal clears the line in your areas. `Pick your areas →`" (`/welcome`) when `!prefs.onboarded`, else plain copy.
- [ ] **Step 3:** Search: when signed in and `prefs.areas` empty, a single dismissible `.prov` line above results: "Tell us your markets and we'll watch them for you → " (`/welcome`; dismiss = localStorage, not prefs).
- [ ] **Step 4:** jsdom tests for the conditional CTAs (mock `usePrefs`); full suite + typecheck; commit — `feat(user): empty states route into onboarding`

## Task 5: Deploy + activation proof

- [ ] Build one + worker, restart `oper-app`, `oper-worker-alerts`, `oper-worker-digest`.
- [ ] **Wizard proof:** fresh signup → lands on `/welcome` → pick Houston + Cleveland, rate 6.0/down 25, opt in → `/search` shows the two area chips; `/api/prefs` GET reflects everything; revisiting `/welcome` shows the "You're set up" screen.
- [ ] **Alert loop proof:** within ≤2 ticks (10 min), `alert_events` gains rows for that user in those areas (the tick logs `eventsInserted > 0`); bell shows unread; with `RESEND_API_KEY` present the email arrives with working property links + unsubscribe (without the key: `delivered_at` behavior per free-tier digest batching — verify the log line notes email-disabled once).
- [ ] **No-regression:** signed-out homepage/search untouched; `pnpm` suites green in CI.

## Self-Review

**Spec coverage:** wizard seeds areas+rates in ≤60s (T2) · alert machinery gets real input (T2→T5 proof) · email leg live behind one env var, reusing digest plumbing + unsubscribe (T3) · dead ends now recruit (T4) · skippable, session-gated, no new storage (constraints). Covered.

**Placeholder scan:** the one located-at-execution item (signup redirect site) has an explicit locate step with the grep target; all other steps name exact files; test intents are concrete and assertable.

**Type consistency:** `InvestorPrefs` extended in T1 and consumed by T2 (wizard save) + T3 (alertOptIn read) + T4 (onboarded conditionals); `renderAlertEmail` contract defined and consumed inside T3 only; no cross-task drift surface.
