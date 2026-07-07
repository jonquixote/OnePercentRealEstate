# apps/one Frontend Overhaul — Design Spec

**Date:** 2026-07-07 · **Status:** approved scope (Cycle 3 frontend pivot)
**Executor profile:** frontend coder, no prior repo context. Every bug below was root-caused against the live system on 2026-07-07 — fix the CAUSE named, don't re-diagnose from the symptom.
**Design artifacts:** `plans/redesign/` (README = thesis, tokens.css, 4 page examples). The examples are the visual contract; this spec is the engineering contract.

---

## 1. Goal

Two threads, one PR series:
**A. Make it true.** Six user-visible breakages, all with known root causes (§3) — the backend earned trust in Waves 0–8; the frontend still lies about it.
**B. Make it worthy.** Adopt the "Private Bank for Property" design system (§4) and surface every feature the platform now has but the UI hides (§5).

## 2. Global constraints

- Stack: Next 16 App Router, Tailwind v4 tokens in `apps/one/src/app/globals.css`, dark-only ink system, `@oper/primitives` for all financial math (one-truth rule — NO component-local formulas), nuqs for URL state, MapLibre + pg_tileserv.
- Deploys: rsync + `/opt/onepercent/infrastructure/deploy.sh build app && … up -d --no-deps app`; verify with chrome-devtools-mcp screenshots against one.octavo.press per workstream.
- Every model number renders with band + provenance (design rule #4). Every list surface must handle rent's three states: **estimated** (number+band) / **queued** (pending) / **not rentable** (LAND etc.) — the infinite "Calculating…" spinner is banned.
- `market_benchmarks` (1 dead row) is FORBIDDEN as a data source. Truth tables: `hud_safmr` (193K), `zcta_demographics` (67.5K, ACS 2024), `census_tracts` (NRI flood), `sold_listings` (accruing since 2026-07-07), `listings` enrichment columns, `listings_history`.

## 3. Thread A — root-caused fixes (do these first; each independently shippable)

### A1 — Non-rentables pass the "1% rule only" filter  ⚠ trust-killer
**Root cause (verified):** `apps/one/src/app/actions.ts` ~line 133: the filter is
`COALESCE((estimated_rent / NULLIF(price,0)) >= (SELECT target_ratio FROM resolve_rule(...)), TRUE)`.
The `COALESCE→TRUE` exists so flip/STR (NULL `target_ratio`) aren't bogusly gated — but it ALSO returns TRUE when `estimated_rent` is NULL, which is now every LAND/lot (Wave 2 made non-rentables NULL) and every queued row. Houseless lots therefore "meet" the 1% rule.
**Fix:** the gate becomes: `public.is_rentable(property_type) AND estimated_rent IS NOT NULL AND COALESCE(ratio >= target, TRUE)` — rentable rows with a NULL target (flip/STR) still pass (intended), rent-less rows never do. Mirror the same guard in the viewport/map query path and `/api/featured` if they expose a rule-gated mode (grep `resolve_rule` across `apps/one/src/app`).
**Acceptance:** `/?op=true` returns zero rows with `property_type` in the non-rentable set (verify by SQL: run the page's exact query with `AND NOT public.is_rentable(property_type)` → count 0); a LAND listing's card shows "land · not rentable" (see A6), not a ratio and not a spinner.

### A2 — "OnePercent Smart Estimate" / financial analysis dead
**Root cause (verified):** `apps/one/src/app/api/estimate-rent/route.ts` calls the **legacy SQL `calculate_smart_rent()`** — the v0-era triangulation whose HUD input is the dead `market_benchmarks` table. `AdvancedRentEstimator.tsx` (and whatever else posts to `/api/estimate-rent`) therefore renders nulls/garbage. The platform's real estimator (v1 LightGBM + bands) never reaches this UI.
**Fix:** rewrite `/api/estimate-rent` to: (1) serve the STORED truth for a listing id — `estimated_rent, rent_low, rent_high, rent_model_version` from `listings` + `hud_safmr` FMR for (zip, beds); (2) for what-if inputs (user-adjusted beds/sqft), proxy to the ml service `http://ml:8000/predict` (server-side fetch; the wire contract is `PredictRequest`/`PredictResponse` in `services/ml/main.py` — includes `rent_low/high`). Response shape: `{ estimate, low, high, model_version, hud_fmr, comps_median }` — keep `comps_median` via a direct query on `rental_listings` medians (5km/90d) since the UI displays a comps line. Delete the `calculate_smart_rent` call; leave the SQL function untouched (other legacy consumers may exist — grep and report, don't break).
**Acceptance:** detail page's estimator section shows the v1 number matching the listing row, the band, FMR line, model version chip; changing beds in the what-if recomputes via `/predict` (visible network call, sane result).

### A3 — "Rent vs HUD FMR" + Market Data section dead
**Root cause (verified):** market surfaces (`market/[zipcode]/page.tsx`, `analytics/page.tsx`, `PropertyMarketTab.tsx`) read `market_benchmarks` and/or FRED series that render silently empty on failure.
**Fix:** rebuild the market page on the truth tables per `plans/redesign/example-market.tsx`: FMR-vs-model chart from `hud_safmr` (all 5 BR sizes for the zip) vs model medians (`SELECT percentile_cont(0.5)… FROM listings WHERE zip_code=$1 AND rent_low IS NOT NULL GROUP BY bedrooms`), ACS strip from `zcta_demographics`, sold stats from `sold_listings` (90d count + median $/sqft), cuts/clears counts from listings. `getMarketTrends()` (lib/fred): keep, but every failed series renders an explicit "series unavailable" row instead of silent-empty — no invisible failures.
**Acceptance:** `/market/44113` (or any top-listing zip) renders all four sections with real values; killing FRED key in a test env shows the explicit unavailable state, not blankness.

### A4 — Schools empty
**Root cause (probable, verify first):** `PropertyOverviewTab.tsx:369` parses `raw_data.nearby_schools` only when it's a string array; homeharvest emits arrays of objects/strings varying by market, and rows checked on prod had none populated at the sampled offset. **First step:** measure — `SELECT jsonb_typeof(raw_data->'nearby_schools'), count(*) FROM listings WHERE raw_data->'nearby_schools' IS NOT NULL AND raw_data->>'nearby_schools' <> 'null' GROUP BY 1;` on prod.
**Fix:** defensive parser (string | {name, distance?, rating?} | nested list) in a small helper w/ unit test; render per the "Locale" section of `example-property-detail.tsx`; when the listing has none, show tract-level context instead (never an empty header). If measurement shows coverage <10%, add schools to the Wave-1-style extraction path (scraper `extra_property_data` already fetches them per Track B-era findings) and note the backfill as a follow-up — don't block the section on it.
**Acceptance:** a listing with schools data renders the list; one without renders Locale (ACS + flood) without an empty "Schools" header; parser unit tests green.

### A5 — Map: unclickable points, dark-on-dark
**Root cause (verified in `PropertyMap.tsx`):** click handler exists (`map.on('click','mvt-points')` → `router.push`) but (a) point radius is 5–11px — sub-Fitts targets; (b) cluster (MV zooms 0–13) → point (MVT) handoff can leave zoom bands where neither layer is comfortably interactive; (c) emerald-on-dark basemap with no halo = poor contrast; (d) hover popup competes with click.
**Fix (all four, per the map legend in `example-search.tsx`):**
1. Invisible hit layer: duplicate circle layer under `mvt-points`, radius 22, `circle-opacity: 0`, attach click/hover to BOTH layers.
2. Zoom-band audit: log layer visibility at zooms 10–16 against tile responses; ensure `mvt-points` minzoom overlaps the clusters' maxzoom by ≥1 level; fix whichever side gapes.
3. Palette: points get 1.5px `#0b0d10` stroke + selected-state 2px warm-white halo (`feature-state`), price-cut listings render brass (`price_cut_pct > 0` — add the property to the MVT function's output if absent: check `2026_07_02_mvt_filter_params.sql` for the column list), basemap label contrast raised via style layer overrides (openfreemap dark: bump `text-color` lightness on place/road labels).
4. Click → anchored mini-dossier card (photo, ratio, band, price, "Open →") replacing bare hover popup; hover keeps a slim tooltip. Build with `textContent` (XSS precedent d5bc2aa).
**Acceptance (browser, chrome-devtools-mcp):** at z14+ clicking within 20px of a point opens the card; card link navigates; cut listings visibly brass; zero console errors; screenshot set (z8/z11/z14/z16) attached to evidence.

### A6 — Card honesty states (kills the eternal spinner)
**Root cause:** `components/ui/card.tsx` treats `!estimated_rent` as "Calculating…" forever — false for non-rentables (NULL forever by design) and misleading for LAND.
**Fix:** rent tri-state per §2: `is_rentable === false` (plumb `public.is_rentable(property_type)` through `getProperties` select — one extra column) → "land · not rentable" chip; rentable + NULL → "estimate queued"; else number + band. Apply the same tri-state to the detail rail and featured cards.
**Acceptance:** the three states visible on `/`, no spinner anywhere after data loads.

## 4. Thread B1 — design adoption ("Private Bank for Property")

Contract = `plans/redesign/` examples. Adoption order (each its own PR-sized commit):
1. **Foundation:** merge `tokens.css` into `globals.css` (extend, don't break existing `bg-ink`/`text-brass-hi` classes — the new tokens keep old names); add Fraunces via `next/font` as `--font-fraunces` (display ONLY — h1/h2 + hero); add the `.rule-line`, `.band`, `.prov`, `.mat`, `.figure` utility classes.
2. **Home** per `example-home.tsx`: frontispiece hero (serif + the single glowing rule-line + engraved ticker strip), featured→mats w/ one-loud-metric cards, reduced rail → engraved list rows (brass only). RatioTape/MarketPulse survive restyled (hairline axes, no boxed cards).
3. **Search/browse** per `example-search.tsx`: pill toolbar (Filters button opens the existing panel; active filters render as removable chips bound to nuqs state), gallery cards (A6 states), map panel w/ A5 fixes + mini-dossier.
4. **Detail** per `example-property-detail.tsx`: tabs → single-scroll dossier (Overview/Financials/Market merge; keep anchors + a slim in-page nav for deep-linking), sticky verdict rail (A2 data), rent-three-ways, sold-comps section (§5 F3), Locale.
5. **Market** per `example-market.tsx` (A3 is the data half; this is the visual half).
6. **Sweep:** login/pricing/compare/settings/analytics restyled to tokens (lighter touch — consistency, not redesign).
Design QA gate per page: side-by-side screenshot vs example, reviewed before the next page starts. Reduced-motion + keyboard focus states mandatory (existing a11y precedent in MarketPulse).

## 5. Thread B2 — feature-integration matrix (built but invisible)

| # | Built (wave) | Surface it |
|---|---|---|
| F1 | Rent bands p10–p90 (W2) | `.band` under every rent figure: cards, rail, featured, map card, estimator |
| F2 | Provenance (W3: tax/insurance/rate/ARV sources) | `.prov` chips in verdict rail + scorecard (exists — restyle + extend to rate/FRED "live" chip) |
| F3 | `sold_listings` (Track B, accruing) | Detail "what actually sold nearby" + market-page sold stats + **B4 ARV chain: sold-comps P75 → estimated_value → asking-comps, provenance-labeled, precedence in `@oper/primitives` w/ SQL parity test** (Track B spec §B4 — unimplemented; land it here since it's a detail-page feature) |
| F4 | `zcta_demographics` (Track B) | Market page ACS strip + detail Locale + (stretch) income filter chip |
| F5 | NRI flood + `census_tract` (Track B; loads running) | Detail Locale risk line — "risk index", NEVER "flood zone" (v1 is NRI scores) |
| F6 | `hud_safmr` (W2) | Rent-three-ways (detail) + FMR-vs-model chart (market) |
| F7 | Price-cut layer (W4) | Already on cards; ADD: history sparkline is live — give it the cut path annotation (first→now $); map brass points (A5.3) |
| F8 | Motivated-seller score (W4) | Detail masthead chip (exists in intel strip — promote per example) + sort already live |
| F9 | Watchlists/auth (W5) | "Watch this property" on detail rail (listing-scoped watchlist: `{zip_code, price:{max: price*1.05}, bedrooms:{min,max}}` via the existing `/api/watchlists`) + a `/account` page listing watchlists + saved searches w/ delete (routes exist; page doesn't) |
| F10 | Stripe (W5) | Pricing page: agency tier CTA → "contact" until `STRIPE_PRICE_AGENCY` exists (today it 400s — make the UI honest) |
| F11 | `days_on_market` real (W8 wrap) | Card DOM chip exists; add to detail masthead per example |

## 6. Sequencing

```
A1+A6 (trust, 1 PR) → A2+A3 (financial+market data, 1–2 PRs) → A4+A5 (locale+map)
→ B1.1 foundation → B1.2..6 page-by-page (each folds in its §5 F-items)
```
~2 weeks. Thread A alone is shippable in ~3 days and should deploy before any restyling (truth before beauty).

## 7. Verification protocol

Per PR: typecheck + `next build` + deploy + **browser evidence** (screenshots via chrome-devtools-mcp: the page, its example counterpart, and the A-fix proof) appended to `docs/superpowers/plans/frontend-overhaul-evidence.md`. A1 additionally proves by SQL (§A1). No PR merges showing a naked estimate, an eternal spinner, or `market_benchmarks` in its diff.
