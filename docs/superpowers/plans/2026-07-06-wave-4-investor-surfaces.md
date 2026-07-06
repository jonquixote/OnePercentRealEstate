# Wave 4 — Investor Surfaces: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline).

**Goal:** The data Waves 1–3 unlocked becomes visible product: price-cut signals everywhere, motivated-seller score, enriched detail page (source link, schools, last-sold, est-value gap, description), new filters, MapLibre verified, market pages SEO-enriched.

**Architecture:** Price-cut facts derive from `listings_history` at query time via a lateral join (no derived columns yet — history is young; revisit materialization in Wave 7 if hot). Motivated-seller score = SQL expression (cuts + DOM + distress weights) exposed by `getProperties`/featured, formula mirrored in `@oper/primitives` for the parity test. Detail enrichment reads Wave 1 columns + `raw_data->nearby_schools` (parsed server-side, no new column). UI slots into the existing dark "line" design system.

**Spec:** Wave 4 section (incl. the 4-fact MapLibre pass definition). **Depends on:** W1 (history + enrichment), W2 (bands), W3 (provenance) — W2/W3 for full effect; degrade gracefully if bands/provenance absent.

## Global Constraints
- Wave 0 rules; dark design tokens (`bg-ink`, `text-brass-hi`, `border-line`, `bg-pass` — globals.css); XSS-safe description rendering (textContent/sanitized, matching the map-popup precedent d5bc2aa).
- Query changes must respect the standing `sale_type='standard'` default + $10K price floor conventions.
- Branch `wave/4-investor-surfaces`.

### Task 1: Price-cut data layer
**Files:** `apps/one/src/app/actions.ts` (getProperties/getProperty), `/api/featured/route.ts`, `packages/primitives/src/underwriting.ts` (motivated-seller formula), `packages/query-lang` ALLOWED_COLUMNS (+price_cut_pct, days_on_market).
- [ ] Lateral join: `LEFT JOIN LATERAL (SELECT price AS first_price FROM listings_history h WHERE h.listing_id=l.id ORDER BY observed_at ASC LIMIT 1) h0` → `price_cut_pct = (h0.first_price - l.price)/h0.first_price` when positive; `cut_count` via count of decreasing transitions (window fn in a small CTE — measure cost; history is small for now).
- [ ] `motivatedSellerScore(cutPct, cutCount, dom, saleType)` in primitives (0–100; weights documented; distress types get a floor boost). SQL mirror in the same query; parity test case.
- [ ] Sort `biggest_cut`; filters `hoaMax`, `domMin`, `hasPriceCut`, `minRentConfidence` (uses W2 `rent_low/high` spread) wired through nuqs → getProperties whitelist.
- [ ] Acceptance: API returns cut fields; poked-price listing from W1 Task 5 shows a cut; typecheck/tests.

### Task 2: Price-cut UI
**Files:** property card component (grep `targetPct` usage — card.tsx), `home/FeaturedDeals.tsx`, new `home/ReducedRail.tsx`, detail `PropertyHeader.tsx` + a sparkline in `PropertyOverviewTab.tsx` (history endpoint `/api/properties/[id]/history` already exists).
- [ ] Card badge `−X% since list` (brass), DOM chip. Detail: price-history sparkline (reuse chart primitives in `components/charts`), motivated-seller meter.
- [ ] Home: "Reduced" rail (biggest cuts, standard sale_type) under featured.
- [ ] PropertyFilters: the new filter chips (match existing chip pattern).
- [ ] Acceptance: prod screenshots (chrome-devtools-mcp), dark-theme consistent, reduced-motion safe.

### Task 3: Detail enrichment
**Files:** `PropertyOverviewTab.tsx`, `PropertyHeader.tsx`, `actions.ts` getProperty SELECT.
- [ ] Source link (`property_url`, rel=noopener, source-branded label); last-sold line ("sold 2019 · $250K → asking +22%"); est-value gap badge ("listed 8% under estimate" when `price < estimated_value×0.97`); neighborhood/county line; schools accordion from `raw_data->'nearby_schools'` parsed server-side (defensive: absent/malformed → hidden); sanitized `description` block (clamp + expand).
- [ ] Acceptance: screenshot listing WITH all fields + one with none (graceful absence).

### Task 4: MapLibre e2e verification (spec 4-fact pass)
- [ ] (1) tiles load z8–14; (2) pins render from viewport query; (3) zero `mapbox-gl` console errors; (4) `NEXT_PUBLIC_MAPBOX_TOKEN` removed from prod .env + compose env. Use chrome-devtools-mcp against one.octavo.press. Fix what fails (recent swap is unverified — budget real time here).
- [ ] Acceptance: all four facts recorded with screenshots in the wave baseline file.

### Task 5: SEO market pages
**Files:** `app/market/[zipcode]/page.tsx`, `app/sitemap.ts` (create if absent).
- [ ] Enrich zip pages: FMR (hud_safmr), price-cut count, distress counts, ACS placeholder note (Wave 1b). JSON-LD (`Schema` primitive exists). Sitemap over active-listing ZIPs (cap 5K entries, ISR daily).
- [ ] Acceptance: `curl` a zip page → enriched content + valid JSON-LD; sitemap.xml 200.

### Task 6: Deploy + acceptance battery
- [ ] typecheck/tests/build both apps → deploy app → screenshot pass (home, list w/ new filters, detail enriched, map) → 0 new prod errors → memory update.
- Exit: price-cut list→detail→map consistent; all Task 4 facts pass; new filters functional end-to-end.
