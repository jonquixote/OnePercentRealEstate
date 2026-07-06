# Wave 4 — Investor Surfaces: Acceptance Evidence (2026-07-07)

## Task 1 — price-cut data layer
- `2026_07_07_price_cut_columns.sql`: trigger-maintained `first_list_price` / `price_cut_pct` / `price_cut_count` (the history trigger became BEFORE UPDATE and stamps them on the same write).
- **Deadlock lesson:** the original single-statement 944K-row backfill deadlocked against live scraper upserts → rewritten as keyset-batched OOB procedure (`backfill_price_cuts`, FOR UPDATE SKIP LOCKED). Completed: **944,506 rows stamped, 1,113 standard-inventory price cuts captured** (2 days of history), max 6 cuts on one listing.
- Partial index `idx_listings_price_cut` → `biggest_cut` sort = **index scan, 1.5 ms**.
- `motivatedSellerScore` (0–100: cut depth 45 + cut count 15 + staleness 25 + distress 15) in `@oper/primitives` with SQL twin one screen apart; TS↔SQL parity spot-verified on prod (56 = 56); 5 unit tests.
- New filters: `hoaMax` (NULL-permissive), `domMin`, `hasPriceCut`, `minRentConfidence` (1 − band-spread/rent). New sorts: `biggest_cut`, `stalest`. query-lang gains the 6 new columns.

## Tasks 2–3 — UI (deployed + browser-verified on one.octavo.press)
- Card: brass "−X% cut" badge (stacks under distress), DOM chip, "Motivated N" chip (≥60), rent-band subtext.
- Filters: "Seller Signals" chip row (Price Reduced / 30·60·90+ DOM / HOA caps) URL-synced via nuqs (`cut`, `dom`, `hoamax`).
- Detail: seller/value intel strip (cut since list with $ path, listed-under-est-value badge, last-sold delta, motivation meter, neighborhood/county, source-listing link rel=noopener), sanitized clamped description, model rent range in the Rent Potential card.
- Live proof (`/?cut=true`): 100 filtered cards; first card renders `−57% cut` + `rent range $1,060–$3,003` ($15K Concord AR listing).

## Task 4 — MapLibre verification (spec 4-fact pass): **ALL PASS**
1. Tiles: openfreemap dark style + planet tiles fetching (12 requests), map paints roads/boundaries; zoom exercised.
2. Pins: green cluster circles with counts (139/99/131…) rendered from viewport/cluster API (calls 2→6 across zooms). Screenshot taken.
3. Console: **zero mapbox-gl errors.** Only failures: `/api/saved-searches` 501 ×4 (pre-existing auth stub → Wave 5) and one external openfreemap font 404 (cosmetic).
4. `NEXT_PUBLIC_MAPBOX_TOKEN` removed from prod `.env` (backup: `.env.bak-wave4`) + verified absent in the app container; zero code references remain (one stale comment).

## Task 5 — SEO market pages: **DEFERRED to the Wave 5–8 plan**
Scope decision: core W4 value (data layer → UI → map verification) shipped and verified; the market-page enrichment + sitemap ride with Wave 5's public-surface work where they share files. Also deferred there: home "Reduced" rail + detail price-history sparkline (same components as W5 home/detail touches).

## W2/W3 finishing sweeps done in this session
- Re-pended 76,428 pre-band v1 rows → bands backfilled; final zeros → NULL (166); `2026_07_06_rent_zero_to_null` + `fix_history_seed_timestamp` recorded in schema_migrations.
- Nightly retrain observed end-to-end: **PROMOTED** (fresh train 356 s, gate ratio 0.629, 15/15 states).
- Wave 3 verified live: FRED 6.43 via `/api/mortgage-rates` 200, `resolveCosts` w/ `assessed_tax` fallback (real `tax_annual_amount` is 0% — confirmed unavailable at scrape; assessed_value ~81% carries it), state insurance join, provenance chips in scorecard. Primitives: 36 tests green.
