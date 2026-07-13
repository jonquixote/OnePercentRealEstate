# Frontend Form & Function — apps/one Navigation, First-Run, Mobile, Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one.octavo.press feel finished: coherent navigation and information architecture, a first-run experience that teaches the 1% thesis in 30 seconds, a mobile experience that isn't desktop-squeezed, and a consistency pass (typography, loading, imagery, a11y) across every page.

**Architecture:** No new frameworks. Work happens inside the existing "line" motif design system (`apps/one/src/app/globals.css` tokens: `--ink*`, `--pass*`, `--brass*`, `--line*`, `.figure`, `.prov`, `.mat`, `.band`) and `@oper/primitives`. Every task is a page/flow slice that ships independently. Visual changes get before/after screenshots in the PR; the Lighthouse budget from the map overhaul (LCP < 2.0s desktop, CLS < 0.05) is the standing gate.

**Tech Stack:** Next 16 App Router, Tailwind 4 + CSS tokens, nuqs, TanStack Query via @oper/api-client, existing primitives.

## Global Constraints

- **Design tokens only** — no new hex values in components; extend `globals.css` if a token is genuinely missing. Read two neighboring components before writing any JSX.
- **Deploys via `ops/systemd/deploy-systemd.sh app`**; verify live after every phase (screenshot + console-clean check via Playwright, the pattern from the map overhaul).
- **Mobile = 390px first** for every touched surface; test at 390/768/1280.
- **No new dependencies** without listing the alternative considered; the app has everything it needs (lucide, nuqs, tanstack, maplibre).
- **`prefers-reduced-motion` + `:focus-visible`** rules from D4 apply to all new interactions.
- **Every fetching component**: fixed-height skeleton → data → designed empty state (icon + one line + one action). No raw "No results", no spinner-only screens, no CLS.

## Current-state findings (read these before starting)

- Pages: `/ /account /analytics /calculator /compare /comps /login /market/[zip] /playbook /portfolio /pricing /property/[id] /search /settings /sold/[id] /strategy/[slug]` — 16 surfaces, grown wave-by-wave; IA never designed as a whole. `/analytics`, `/comps`, `/playbook`, `/calculator` overlap conceptually with `/search` and property pages.
- `Header.tsx` has an "explore" dropdown; footer state unknown; no breadcrumbs anywhere; `/market/[zip]` (new SEO surface) is not linked from navigation.
- Auth exists (`useSessionUser`, tier free/pro) but the logged-out vs logged-in experience is nearly identical; `pricing` is the only tier-aware surface plus the compare gate.
- `PropertyFilters.tsx` is 445 lines and the search toolbar hosts 8+ controls (filters/chips/sort/table/map/copy/watch/saved) — crowded at 1280px, broken at 390px.
- No PWA manifest/icons audit; unknown OG-image coverage for share cards.

---

## Phase N — Navigation & information architecture

### Task N1: IA map + navigation redesign

**Files:**
- Modify: `apps/one/src/components/Header.tsx`
- Create: `apps/one/src/components/Footer.tsx` (if absent — check `apps/one/src/app/layout.tsx` first)
- Modify: `apps/one/src/app/layout.tsx`

- [ ] Write the IA doc first (30 lines in the PR description): primary nav = **Search · Markets · Portfolio · Pricing**; secondary (footer + ⌘K only) = analytics/comps/playbook/calculator/strategy. Every page must be reachable in ≤ 2 clicks from home; orphans (currently `/market/[zip]`) get nav homes.
- [ ] Header: 4 primary items + auth affordance. Logged-out: "Sign in" + accent "Get started" → `/pricing`. Logged-in: avatar menu (Account, Settings, Saved searches, Sign out) + `pro` badge when tier=pro. Active-route underline in the line motif.
- [ ] Footer: 3 columns (Product / Markets: top-8 metro `/market/[zip]` links for SEO internal linking / Company+legal), muted, consistent on all pages.
- [ ] Mobile: sheet menu with the same hierarchy; visible focus rings; `aria-current="page"`.
- [ ] Acceptance: click-depth audit table in PR (every page ≤ 2 clicks); mobile menu keyboard-navigable. Screenshots 390/1280. Commit.

### Task N2: Page consolidation decision — analytics/comps/playbook/calculator

- [ ] Audit each of the four pages: traffic assumption, unique value, overlap. Propose to the user ONE of: (a) merge into `/search` + property pages as panels, (b) keep all four but unify under a "Tools" IA section with consistent heroes, (c) retire some with redirects. **This is a user decision — present the audit, don't unilaterally delete pages.**
- [ ] Implement the chosen option, with 301 redirects (`next.config` `redirects()`) for anything moved.
- [ ] Acceptance: no orphaned links; sitemap reflects final IA. Commit.

### Task N3: Breadcrumbs + cross-linking loop

**Files:**
- Create: `apps/one/src/components/Breadcrumbs.tsx`
- Modify: `apps/one/src/app/property/[id]/page.tsx`, `apps/one/src/app/market/[zip]/page.tsx`, `apps/one/src/app/strategy/[slug]/page.tsx`

- [ ] `Breadcrumbs items={[{label, href}...]}` with `BreadcrumbList` JSON-LD. Property page: Home → `{City} {ZIP}` (→ `/market/[zip]`) → address. Market page: Home → Markets → ZIP.
- [ ] Property page links its ZIP's market page prominently ("Market context: 90004 →"); market page already lists properties — verify the loop closes both directions.
- [ ] Acceptance: crawl loop property↔market verified; JSON-LD validates in Rich Results test. Commit.

---

## Phase F — First-run & conversion flow

### Task F1: Homepage as a 30-second thesis pitch

**Files:**
- Modify: `apps/one/src/app/page.tsx` + `apps/one/src/components/home/*`

- [ ] Read the current homepage fully first. Restructure to: (1) one-line thesis + live stat strip (from `/api/stats` — already exists), (2) an **interactive taste of the product**: embedded mini-map (the `@oper/map` MiniMap pattern) centered on a dense metro with rent-heat on + 3 featured deal cards, (3) "how the 1% rule works" 3-step explainer with a worked example using a REAL current listing, (4) market-page teaser grid (top 6 metros), (5) single CTA band.
- [ ] Every number on the page is live data; no marketing lorem.
- [ ] Acceptance: LCP < 2.0s (the mini-map lazy-mounts below the fold), one clear primary CTA above the fold, screenshots. Commit.

### Task F2: First-visit guidance on /search

**Files:**
- Create: `apps/one/src/components/search/FirstRunCoach.tsx`
- Modify: `apps/one/src/app/search/page.tsx`

- [ ] One-time (localStorage `oper:coach:search`) 3-step coach-marks: ① the ratio figure on a card ("green = clears the 1% line"), ② the rent-heat layer toggle, ③ save search. Small anchored popovers, dismiss-all always visible, never blocks input, never shows again after dismiss or 3rd step.
- [ ] Acceptance: appears exactly once per browser; keyboard dismissible; no CLS. Commit.

### Task F3: Signed-out → signed-in continuity

**Files:**
- Modify: `apps/one/src/app/login/page.tsx`, `apps/one/src/components/WatchSearchButton.tsx`, gated affordances

- [ ] Every auth-gated action (watch, digest opt-in, >2 compare) routes through one `requireAuth(intent)` helper: opens login with `?next=` + a one-line reason ("Sign in to get email alerts for this search"). After auth, complete the original intent (the claim-on-login migration already preserves their anonymous data — surface that: "Your 3 saved searches came with you ✓").
- [ ] Login/signup page: match the design system (it predates the redesigns — verify), show the value props next to the form.
- [ ] Acceptance: watch-search while signed out → login → returns and completes the watch, toast confirms. Commit.

---

## Phase M — Mobile experience

### Task M1: Search page mobile rebuild

**Files:**
- Modify: `apps/one/src/app/search/page.tsx`, `apps/one/src/components/PropertyFilters.tsx`

- [ ] At < 1024px: map and list become **tabs** (segmented "List | Map" pinned bottom-center, the standard pattern) instead of the current stacked/hidden arrangement; map tab is full-viewport with the existing controls.
- [ ] Toolbar diet: at < 640px collapse to [Filters (count badge)] [Sort] [•••  overflow: table/copy/watch]. Filter panel becomes a bottom sheet (max-height 85vh, drag-handle, sticky Apply bar showing live result count).
- [ ] `PropertyFilters` internal cleanup while touched: extract the 445-line component into `filters/` module (RangeField, SegmentField, sections) — no behavior change, just navigability.
- [ ] Acceptance: full search flow (filter → map browse → property) on 390px without horizontal scroll or lost functionality; screenshots. Commit.

### Task M2: Property page + compare mobile pass

- [ ] Property page 390px: hero photo aspect, sticky CTA bar (price + est. rent + Watch) replacing the desktop right rail, sections single-column, MiniMap full-width, StickyTabNav horizontal-scrollable with edge-fade.
- [ ] Compare page: columns become horizontally snap-scrollable cards with the metric labels as a sticky first column.
- [ ] Acceptance: no clipped content at 390px on 3 real listings; tap targets ≥ 44px. Commit.

### Task M3: PWA basics + share cards

**Files:**
- Create: `apps/one/src/app/manifest.ts`, verify `apps/one/src/app/opengraph-image.tsx` coverage
- Modify: `apps/one/src/app/property/[id]/page.tsx` metadata

- [ ] Manifest (name, icons from the existing logo, standalone display, theme = ink token); iOS meta tags.
- [ ] OG images: property pages generate dynamic share cards (photo + price + ratio figure) via `next/og` if not already present (`grep -r opengraph apps/one/src` first); market pages get the stat-strip card.
- [ ] Acceptance: Lighthouse PWA installable; property link pasted in a chat shows the card. Commit.

---

## Phase P — Polish & consistency sweep

### Task P1: Typography + surface audit

- [ ] One pass over all 16 pages against a checklist: display font usage (`--font-display`) only on page heroes; `.figure` for ALL numerals (find raw numbers with default font); `.prov` for provenance lines; consistent card radii (`--r-panel`/`--r-mat`); consistent page gutters (`max-w-7xl px-6 lg:px-8`). Fix deviations page by page — one commit per page touched, screenshots in PR.
- [ ] Acceptance: side-by-side gallery of all pages in the PR showing consistent rhythm.

### Task P2: Image handling

- [ ] Audit `next/image` usage: every listing photo through `<Image>` with proper `sizes`; blur placeholders where `media_blur` exists (column already in the API); explicit aspect boxes everywhere (CLS 0). Check `next.config` `images.remotePatterns` covers all photo hosts observed in the DB (`SELECT DISTINCT substring(primary_photo from '^https?://[^/]+') FROM listings WHERE primary_photo IS NOT NULL LIMIT 20;`).
- [ ] Broken-photo fallback: the "Photo pending" mat everywhere a photo can 404 (onError swap), not just SearchCard.
- [ ] Acceptance: no layout shift on slow-3G photo loading; no broken-image icons. Commit.

### Task P3: Accessibility pass

- [ ] Keyboard walk of the 5 core flows (home→search→filter→property→compare); fix traps, missing labels, contrast < 4.5:1 (the muted tokens `--mute`/`--haze` on `--ink-panel` need checking), missing `aria-live` on async result counts.
- [ ] Screen-reader labels for the map: the `role="application"` region gets an instructions string; layer toggles + basemap announce state.
- [ ] Acceptance: axe-core scan (via Playwright) 0 critical/serious on the 5 core pages. Commit.

### Task P4: Final gate

- [ ] Lighthouse (desktop + throttled mobile) on `/`, `/search`, one property, one market page: LCP < 2.0s/3.0s, CLS < 0.05, a11y ≥ 95. Numbers recorded in the PR. Deploy + live screenshot set.

## Execution order

```
N1 → N2 (user decision) → N3
F1 → F2 → F3
M1 → M2 → M3      (M can run parallel to F)
P1..P3 after N/F/M land → P4 gate last
```
