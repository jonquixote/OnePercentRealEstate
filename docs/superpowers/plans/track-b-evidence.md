# Track B — Data Moat: Acceptance Evidence

## B1 — Sold listings (2026-07-07)
- Code: user-implemented (d871793 + 5d506b4, PR #10 merged). Deployed this session (scraper + worker rebuilt).
- **Sold pass live: 97 rows within the first minute of deploy; 2,918 within ~35 min** and accruing with the crawl. Dedup on (address, COALESCE(sold_date)) — dupes impossible.
- Listings-table growth unaffected (separate table; rent queue untouched, pending stayed ~0).

## B2 — ACS demographics
- **67,543 rows, vintage 2024** (user-loaded with their Census API key).
- Wired into model feature path + market surfaces per spec (adoption decided by the nightly retrain gate).

## B3 — Tracts + NRI flood
- TIGER 2024 load: **84,415 tract polygons** (50 states + DC). Three loader defects found + fixed during execution:
  1. alpine postgis ships `shp2pgsql` linked against a missing `libintl.so.8` — every state "loaded" silently empty behind `2>/dev/null` muzzles. Fix: `apk add gettext-libs libintl` self-heal + unmuzzled pipeline errors.
  2. Stale `staging_tracts` from interrupted runs aborted the whole txn — fixed with `shp2pgsql -d`.
  3. My own self-check grep pattern was wrong (bare shp2pgsql prints RELEASE, not "usage").
- NRI: the spec's download URL had rotted (HTML redirect page). Real source found via the ArcGIS Hub item (`opendata.arcgis.com/api/v3/datasets/9da4eeb936544335a6db0cd7a8448a51_0/downloads/data?format=csv`) — 454 MB CSV. **83,213 / 84,415 tracts scored (98.6%)**.
- `backfill_census_tract` (user's OOB procedure) run against ~950K listings — final tagged count appended below on completion.

## B4 — Sold-comps ARV
- NOT implemented in the user's Track B pass — deliberately folded into the frontend overhaul spec (F3 in `docs/superpowers/specs/2026-07-07-frontend-overhaul-design.md`) since it's a detail-page feature.

## Backfill completion
**954,400 / 957,371 geocoded listings tagged with census_tract (99.7%)** — the 2,971 remainder sit outside TIGER tract polygons (offshore points, territories, geocode edge cases). Acceptance bar was ≥95%. NRI joins live through `census_tract`.
