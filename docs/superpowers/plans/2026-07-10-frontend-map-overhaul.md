# Frontend & Map Overhaul — Top-Notch Free Map + App-Wide Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the map into the product's centerpiece (split-view search, data overlays, satellite, hover-rich pins) and raise the whole frontend a grade: compare tray, command palette, saved-search freshness, table view, and a hard performance budget.

**Architecture:** Keep the existing free stack — **MapLibre GL JS + OpenFreeMap vector tiles + pg_tileserv MVT + `/api/properties/viewport`** — it is already the right architecture; the gap is UX and layers, not technology. The single 400-line `PropertyMap.tsx` splits into a `map/` module (core hook + layer registry + controls). Overlays are pg_tileserv-served tables/views, added as toggleable MapLibre sources. New data panels consume the data-expansion plan's tables when present and hide when absent (the two plans are independently shippable).

**Tech Stack:** Next.js 16 (App Router, RSC), MapLibre GL JS (already a dependency), pg_tileserv (running as `oper-pg-tileserv`, `/tiles/` proxied), OpenFreeMap styles (free, no key), Esri ArcGIS Location Platform basemap for satellite (free tier 2M tiles/mo, key optional), PostGIS, existing `@oper/*` workspace packages.

## Global Constraints

- **Free map stack only.** Base vector: OpenFreeMap (`https://tiles.openfreemap.org/styles/positron` today; add `liberty` as the dark alternative). Satellite: Esri via `NEXT_PUBLIC_ESRI_API_KEY` (free tier) — the toggle renders only when the key exists. No Mapbox, no Google.
- **Both frontends, one map module.** The map code lands in `packages/` as `@oper/map` (follow the existing workspace layout — see `packages/` for `@oper/primitives` conventions) so `apps/one` (consumer, dark "line" motif) and `apps/two` (pro terminal) share it. App-specific styling via props/tokens, not forks.
- **apps/one visual language is the dark "line" motif** (commit 1d28ce1 redesign). New components must reuse its primitives/tokens — read `apps/one/src/components/ui/` and two existing sections before writing any JSX. No new color systems.
- **Performance budget (hard):** map page LCP < 2.0s on Fast 3G-throttled desktop; map interaction (pan/zoom → pins updated) < 300ms p75; property page LCP < 2.0s. Verify with Lighthouse in Task F5.
- **Server changes deploy via the systemd flow** (`rsync` + `systemctl restart oper-app`/`oper-two`); Next builds must copy static assets to the standalone dir (existing deploy.sh handles it — do not regress commit a6e87f9).
- **pg_tileserv serves any PostGIS table/view with a geom column** under `/tiles/public.<name>/{z}/{x}/{y}.pbf` — new overlay = new table/view + restart `oper-pg-tileserv`. Never point the browser at :7800 directly; use the existing nginx `/tiles/` proxy.
- **Every fetch degrades.** Overlay source 404/500 → layer toggle disabled with tooltip "data loading", never a broken map.

## File structure (locked before tasks)

```
packages/map/
  package.json                    # @oper/map, peer dep maplibre-gl
  src/useOperMap.ts               # map init, style, resize, nav controls
  src/layers/listings.ts          # pins + clusters (extracted from PropertyMap)
  src/layers/registry.ts          # LayerDef type + toggle state
  src/layers/rentHeat.ts          # H3 rent surface overlay
  src/layers/tracts.ts            # tract choropleth overlay
  src/layers/context.ts           # flood/transit/schools overlays (data-plan gated)
  src/controls/LayerSwitcher.tsx  # overlay toggles + legend
  src/controls/DrawSearch.tsx     # polygon draw-to-search
  src/controls/BasemapToggle.tsx  # vector | satellite
  src/index.ts
apps/one/src/components/map/MapShell.tsx      # split view list<->map
apps/one/src/components/map/MapCard.tsx       # hover/selected listing card
apps/one/src/components/CompareTray.tsx
apps/one/src/components/CommandPalette.tsx
apps/one/src/components/property/sections/MiniMap.tsx
```

---

## Phase A — Map core

### Task A1: Extract `@oper/map` package with the existing behavior (no visual change)

**Files:**
- Create: `packages/map/package.json`, `packages/map/src/useOperMap.ts`, `packages/map/src/layers/listings.ts`, `packages/map/src/index.ts`
- Modify: `apps/one/src/components/PropertyMap.tsx` (becomes a thin wrapper over the package)
- Test: `packages/map/src/layers/listings.test.ts`

**Interfaces:**
- `useOperMap(opts: { container: RefObject<HTMLDivElement>; styleUrl?: string; onMoveEnd?: (bounds: LngLatBounds, zoom: number) => void }): { mapRef: RefObject<maplibregl.Map | null>; ready: boolean }` — owns init, the ResizeObserver workaround (preserve the existing comment/fix about wrong-height panes), nav control, label-layer dimming.
- `addListingsLayers(map: maplibregl.Map, opts: { tileUrl: () => string; onSelect: (id: string) => void }): void` and `updateViewportData(map, data: ViewportResponse): void` — the `ViewportResponse` type moves here verbatim from `PropertyMap.tsx`.

- [ ] `package.json`: name `@oper/map`, `"peerDependencies": { "maplibre-gl": "^4", "react": "^19" }` (match the versions in `apps/one/package.json` exactly — read it first). Wire into the workspace like `@oper/primitives` is (check root `package.json` workspaces + one existing consumer import).
- [ ] Move code without behavior change; `PropertyMap.tsx` keeps its public props so `/map` page and callers don't change.
- [ ] Test: `updateViewportData` with a clusters payload sets the cluster source and clears pins; with properties payload does the reverse (jsdom + a stubbed `map.getSource`).
- [ ] `pnpm --filter @oper/one build` green; deploy; map renders identically. Commit.

### Task A2: Split-view search page (list ↔ map, synced)

The defining pattern of every serious real-estate product: results list left, map right, hover-sync both directions, "search as I move the map".

**Files:**
- Create: `apps/one/src/components/map/MapShell.tsx`, `apps/one/src/components/map/MapCard.tsx`
- Modify: `apps/one/src/app/map/page.tsx` (or wherever the map route lives — `grep -r "PropertyMap" apps/one/src/app` to find it; likely `/map` or `/search`)

**Interfaces:**
- `MapShell` owns: `selectedId`, `hoveredId`, `searchAsMove: boolean` (default on, persisted to localStorage `oper:map:searchAsMove`), and the shared filter state (reuse `PropertyFilters.tsx` unchanged).
- List rows fire `onHover(id)` → map sets MapLibre `feature-state {hover: true}` on that pin; map pin hover fires back → list row highlights + scrolls into view (`scrollIntoView({block:'nearest'})` — never `center`, it's jarring).

- [ ] Layout: CSS grid `minmax(380px, 32%) 1fr`, list virtualized if > 50 rows (use whatever virtualizer the app already has; if none, plain windowing via `content-visibility: auto` on cards is enough — measure before adding a dep).
- [ ] `searchAsMove` off → floating "Search this area" chip appears after map move (the standard pattern).
- [ ] Pins render as **price pills** at zoom ≥ 13 (`symbol` layer, `text-field: formatted short price` e.g. "$1.2M"/"$3.4K"), dots at 11-12, clusters below — replace the current all-zooms dot approach. Selected pin = accent border + raised `symbol-sort-key`.
- [ ] `MapCard`: hover a pin ≥ 13 → anchored card with photo, price, beds/baths/sqft, est. rent + cap-rate line (the investor identity of this product — not just price). Click → property page. Reuse the existing popup content as the starting point, restyle to the card primitives.
- [ ] URL state: `?bounds=&z=` written on moveEnd (debounced 500ms, `router.replace` shallow) so map searches are shareable/back-button-safe.
- [ ] Acceptance: hover list row 20 → pin highlights; drag map with searchAsMove on → list updates ≤ 300ms after tiles; refresh URL → same viewport restores. Commit.

### Task A3: Draw-to-search polygon

**Files:**
- Create: `packages/map/src/controls/DrawSearch.tsx`
- Modify: `apps/one/src/app/api/properties/viewport/route.ts` (accept `polygon` param)

**Interfaces:** control emits `onPolygon(coords: [number,number][] | null)`; viewport API accepts `polygon=lng,lat;lng,lat;...` and, when present, replaces the bbox WHERE with `ST_Contains(ST_MakePolygon(ST_GeomFromText('LINESTRING(...)')), geom)` — build the WKT server-side from validated floats (max 100 vertices, reject otherwise; never interpolate raw strings into SQL — parameterize the WKT string itself).

- [ ] Implement freehand draw with plain MapLibre events (mousedown→mousemove collect→mouseup close) rendering a `line`+`fill` source — do NOT add mapbox-gl-draw (heavy, mapbox-licensed forks are messy; we need one gesture, ~80 lines).
- [ ] Esc or "Clear" chip removes polygon → bbox search resumes. Polygon persists in URL (`?poly=`) like bounds.
- [ ] Acceptance: draw around Hancock Park → list shows only west-of-Van-Ness listings; clear → full viewport returns. Commit.

### Task A4: Basemap toggle (vector / dark / satellite) + 3D buildings garnish

**Files:**
- Create: `packages/map/src/controls/BasemapToggle.tsx`
- Modify: `packages/map/src/useOperMap.ts` (style swap preserving custom sources/layers)

- [ ] Styles: `positron` (current), `https://tiles.openfreemap.org/styles/liberty` (richer/darker option for apps/one's dark theme — evaluate both against the design, pick ONE as default per app via prop), satellite = Esri imagery style JSON built inline from `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=$NEXT_PUBLIC_ESRI_API_KEY` raster source + required Esri attribution string. Toggle hidden when key absent.
- [ ] Style swap must re-add all custom sources/layers after `setStyle` (`styledata` event, re-run the layer registry — this is why A5's registry exists; if A5 not done yet, re-add listings layers manually).
- [ ] 3D buildings: on zoom ≥ 15.5, `fill-extrusion` from the OpenFreeMap `building` source-layer, height from `render_height`, subtle 0.6 opacity — pure garnish, behind the LayerSwitcher toggle, default ON for apps/one desktop, OFF on mobile (perf).
- [ ] Acceptance: all three basemaps render; custom pins survive style swaps; satellite hidden without key. Commit.

### Task A5: Layer registry + LayerSwitcher control

**Files:**
- Create: `packages/map/src/layers/registry.ts`, `packages/map/src/controls/LayerSwitcher.tsx`

**Interfaces:**

```typescript
export interface LayerDef {
  id: string;                       // 'rent-heat', 'tracts', 'flood', 'transit', 'schools'
  label: string;
  legend: Array<{ color: string; label: string }>;
  minZoom?: number;
  add: (map: maplibregl.Map) => void;      // idempotent; sources+layers
  remove: (map: maplibregl.Map) => void;
  available: () => Promise<boolean>;        // HEAD the tile endpoint once, cache
}
export function useLayerRegistry(map, defs: LayerDef[]): { toggles: Array<{def: LayerDef; on: boolean; available: boolean; set(on: boolean): void}> }
```

- [ ] Toggle state persists (`localStorage oper:map:layers`); re-applied after basemap swaps (A4 hooks this).
- [ ] `LayerSwitcher` = collapsed FAB → panel with toggles + legend + per-layer opacity slider (styled to the app's control primitives).
- [ ] Unavailable layer (tile endpoint 404 → data not loaded yet) renders disabled with "coming soon" tooltip — this is the contract that decouples this plan from the data plan.
- [ ] Acceptance: unit test the registry state machine (jsdom); visual check toggles. Commit.

---

## Phase B — Data overlays (the "top-notch" part)

### Task B1: H3 rent-heat surface (uses data we ALREADY have)

`h3_market_stats` holds ~98K hexes of median rent/sqft — invisible to users today. Materialize geometry once, serve via pg_tileserv, render as the flagship overlay.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_h3_geoms.sql`
- Modify: `services/ml_rent_estimator/market_stats.py` (write hex polygons for new hexes after the stats refresh)
- Create: `packages/map/src/layers/rentHeat.ts`

```sql
CREATE TABLE IF NOT EXISTS h3_geoms (
  h3_8 TEXT PRIMARY KEY,
  geom GEOMETRY(Polygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_h3_geoms_geom ON h3_geoms USING GIST (geom);

CREATE OR REPLACE VIEW rent_heat AS
SELECT g.h3_8, g.geom, s.med_rent_psf, s.n_rent
FROM h3_geoms g
JOIN LATERAL (
  SELECT med_rent_psf, n_rent FROM h3_market_stats m
  WHERE m.h3_8 = g.h3_8 AND m.med_rent_psf IS NOT NULL
  ORDER BY stat_month DESC LIMIT 1
) s ON true;
```

- [ ] `market_stats.py` addition after the upsert: for hexes in `h3_market_stats` missing from `h3_geoms`, compute `h3.cell_to_boundary(h3_8)` → `POLYGON` WKT → insert (bounded: only new hexes, ~hundreds/night).
- [ ] One-time backfill of all ~98K existing hexes via the same function (`python -m ml_rent_estimator.market_stats --backfill-geoms`); restart `oper-pg-tileserv` (it discovers new tables on restart).
- [ ] `rentHeat.ts`: vector source `/tiles/public.rent_heat/{z}/{x}/{y}.pbf`, `fill` layer, color ramp on `med_rent_psf` (5-stop interpolate, colorblind-safe ramp matching app accent scale), opacity 0.45, `fill-opacity` scaled down where `n_rent < 5` (thin data reads faint — honest visualization). minZoom 9.
- [ ] Acceptance: toggle on over LA → Koreatown/Hancock Park price gradient visibly splits 90004 (the flagship demo of the rent-v2 model's worldview). Tile p95 < 150ms (pg_tileserv logs). Commit.

### Task B2: Tract choropleth (income / rent / NRI risk)

**Files:**
- Create: `infrastructure/migrations/2026_07_11_tract_choropleth.sql` (view)
- Create: `packages/map/src/layers/tracts.ts`

```sql
CREATE OR REPLACE VIEW tract_context AS
SELECT c.geoid, c.geom,
       c.nri_overall_score,
       t.median_hh_income, t.median_gross_rent
FROM census_tracts c
LEFT JOIN LATERAL (
  SELECT median_hh_income, median_gross_rent FROM tract_demographics d
  WHERE d.geoid = c.geoid ORDER BY acs_year DESC LIMIT 1
) t ON true;
```

- [ ] One layer, three metric modes (income / rent / risk) — the LayerSwitcher entry gets a small select; `setPaintProperty` swaps the ramp property, no source reload.
- [ ] `line` layer for tract borders at zoom ≥ 11 (subtle, 0.5px, low-opacity) — this is how users SEE the split-ZIP story.
- [ ] Acceptance: income mode over 90004 shows the west/east divide; mode switch < 100ms (paint-only). Commit.

### Task B3: Context overlays — flood, transit, schools (data-plan gated)

**Files:**
- Create: `packages/map/src/layers/context.ts`

- [ ] Three `LayerDef`s over pg_tileserv sources that exist only after the data plan lands: `public.flood_zones` (fill, red scale by zone, sfha hatched — use a `fill-pattern` 4px diagonal image added via `map.addImage`), `public.transit_stops` (circle, rail route_types larger + accent), `public.schools` (symbol w/ school glyph from the style's glyph set, text name at ≥ 14).
- [ ] All three rely on A5's `available()` gating — zero errors when tables absent. NOTE: flood_zones is large; set `minzoom: 10` in the layer AND ask pg_tileserv politely: add `maxFeatures` guard via a simplified view if p95 tile > 300ms (`ST_SimplifyPreserveTopology(geom, 0.0001)` view variant).
- [ ] Acceptance (with data loaded): Houston viewport shows SFHA hatching; LA shows Metro stops. Without data: toggles disabled, console clean. Commit.

---

## Phase C — Property page map + polish

### Task C1: MiniMap section (location context at a glance)

**Files:**
- Create: `apps/one/src/components/property/sections/MiniMap.tsx`
- Modify: `apps/one/src/app/property/[id]/page.tsx`

- [ ] 320px-tall `@oper/map` instance: subject pin (accent, non-interactive map — `dragPan` off, `scrollZoom` off, click opens full map at that viewport `/map?bounds=...&selected=<id>`), basemap toggle (vector/satellite only), rent-heat layer ON by default at 0.35 opacity — every property page quietly showcases the data moat.
- [ ] Nearby comps: fetch 10 nearest actives from the existing viewport API with a small bbox; render as muted dots with price labels on hover.
- [ ] Lazy-mount via `IntersectionObserver` (maplibre is ~220KB — must not affect LCP; `next/dynamic` with `ssr: false` + placeholder skeleton box of identical height to avoid CLS).
- [ ] Acceptance: property page LCP unchanged (±100ms, Lighthouse before/after); map appears on scroll. Commit.

### Task C2: Page information hierarchy pass

**Files:**
- Modify: `apps/one/src/app/property/[id]/page.tsx` + `apps/one/src/components/property/sections/*`

- [ ] Reorder to investor logic: Hero (photos+price+est. rent+cap rate) → Deal numbers (cashflow calculator) → MiniMap → Risk/Neighborhood/Market panels (from data plan when present) → Details → History → Agent.
- [ ] Sticky right rail (desktop ≥ 1280px): price, est. rent band (p10-p90 — we compute it, show it), cap rate, "Add to compare" (C3), watch button. The band renders as a labeled range bar, not a naked number — uncertainty is a feature.
- [ ] Section nav (existing StickyTabNav — commit 247b3df fixed its positioning; extend its tab list to the new order).
- [ ] Acceptance: visual review against 3 listings (LA house, FL condo, TX sfh); no CLS from any section (Lighthouse CLS < 0.05). Commit.

---

## Phase D — App-wide features

### Task D1: Compare tray (2-4 properties side-by-side)

**Files:**
- Create: `apps/one/src/components/CompareTray.tsx`, `apps/one/src/app/compare/page.tsx`
- Modify: `apps/one/src/components/map/MapCard.tsx` + listing cards (add-to-compare affordance)

**Interfaces:** selection state in `localStorage oper:compare` (ids, max 4) via a tiny `useCompare(): { ids: string[]; add(id): void; remove(id): void; clear(): void }` hook (context provider in the app layout).

- [ ] Tray: fixed bottom bar appears when ≥ 1 selected — thumbnails, count, "Compare →", clear. Animates in (respect `prefers-reduced-motion`).
- [ ] `/compare?ids=a,b,c`: server component fetches all, renders column-per-property table: photo, price, $/sqft, est. rent band, cap rate, cash flow @ 20% down (reuse `CashflowCalculator` math — import its calculation function; if the math is inline in the component, extract it to `apps/one/src/lib/underwriting.ts` first and have both consume it), beds/baths/sqft/year, HOA, DOM, risk/walk scores when present. Best value per row highlighted (accent tint on min price-per-sqft, max cap rate, etc.).
- [ ] Acceptance: pick 3 from map → compare page renders < 1s; removing one updates URL; empty state links back to /map. Commit.

### Task D2: Command palette (⌘K)

**Files:**
- Create: `apps/one/src/components/CommandPalette.tsx`
- Modify: `apps/one/src/app/layout.tsx` (mount + hotkey), `apps/one/src/components/GlobalSearch.tsx` (reuse its search endpoint)

- [ ] ⌘K/Ctrl-K opens; sources: address/city/zip search (existing GlobalSearch API), nav commands ("Map", "Portfolio", "Saved searches", "Compare"), actions ("Toggle rent heat", "Satellite view" — dispatch via a tiny event bus the map subscribes to: `window.dispatchEvent(new CustomEvent('oper:map', {detail}))`, handled in `MapShell`).
- [ ] Zero new deps if the app lacks cmdk (`grep cmdk apps/one/package.json`); a 150-line listbox with roving focus is fine and matches the design system better. Full keyboard: arrows, enter, esc; focus-trapped; `role="dialog"` + `aria-activedescendant`.
- [ ] Acceptance: ⌘K → type "90004" → enter → map jumps; type "sat" → enter → satellite on. Commit.

### Task D3: Saved searches freshness + table view

**Files:**
- Modify: `apps/one/src/components/SavedSearches.tsx`, `apps/one/src/app/api/saved-searches/route.ts`
- Create: `apps/one/src/components/search/ResultsTable.tsx`

- [ ] Saved search rows gain `new_matches` count since `last_viewed_at` (add the column if absent — check `\d saved_searches`; migration `2026_07_11_saved_search_seen.sql` with `last_viewed_at TIMESTAMPTZ`), badge in nav when any > 0, opening a search stamps it.
- [ ] `ResultsTable`: sortable columns (price, $/sqft, est. rent, cap rate, DOM, beds) as an alternative to cards on the search page — a list/table/map segmented control. Sorting is server-side via existing search API params (add `sort=` if missing; whitelist column names, never interpolate).
- [ ] Acceptance: save a search, insert a matching listing (via admin/seed route), badge shows 1; table sorts by cap rate desc. Commit.

### Task D4: Motion, empty states, and micro-polish sweep

**Files:**
- Modify: `apps/one/src/app/globals.css` + touched components

- [ ] One motion vocabulary: 150ms ease-out for hovers, 250ms for entrances, all behind `@media (prefers-reduced-motion: no-preference)`. Cards get a 1px accent-line hover treatment consistent with the "line" motif (read how PropertyHero/StickyTabNav do accents first).
- [ ] Every list surface gets a designed empty state (map with no results in polygon, saved searches when none, compare when empty) — icon + one line + one action. No raw "No results".
- [ ] Skeletons audit: every async section renders a fixed-height skeleton (CLS 0). Focus-visible rings on ALL interactive elements (keyboard walk of map page + property page).
- [ ] Commit.

### Task D5: Performance gate (final task, blocks "done")

- [ ] `pnpm --filter @oper/one build` then Lighthouse (desktop + Fast-3G mobile) on: `/`, `/map`, one property page. Budget: LCP < 2.0s desktop / < 3.0s throttled mobile, CLS < 0.05, map JS chunk lazy (verify maplibre absent from the property-page critical path via `next build` output + network tab).
- [ ] `p75` map interaction: with DevTools performance, pan → pins painted < 300ms over 10 trials (record numbers in the PR description).
- [ ] Fix regressions found; re-run until green. Update `docs/DEPLOYMENT_STATE_*.md` current-state doc with the new map architecture. Commit + push.

---

## Execution order

```
A1 → A2 → A3/A4/A5 (parallel after A1)
B1 → B2 → B3        (B1 first — it needs only existing data and is the wow demo)
C1 → C2             (any time after A1)
D1..D4 independent  (any time after A2)
D5 last, blocking
```

Acceptance summary: `/map` is a split-view searcher with price pills, draw-to-search, three basemaps, rent-heat + tract overlays visibly explaining the 90004 split; property pages carry a lazy mini-map with comps; compare/⌘K/table-view shipped; Lighthouse budget green on both apps' key routes.
