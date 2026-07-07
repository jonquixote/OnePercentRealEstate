# Track B — Data Moat: Design Spec

**Date:** 2026-07-07 · **Status:** approved scope (Cycle 3 Track B), ready for implementation planning
**Executor profile:** a coder with no prior context on this repo. Every seam below is verified against the live system as of 2026-07-07.

---

## 1. Goal

Three free data assets that compound:

1. **Sold listings** — actual closed transactions. True sale comps, ARV ground truth for the flip strategy, and the future training target for a price model (today's rent model v1 trains on *asking* rents; sold prices are the equivalent upgrade path for valuation).
2. **Census ACS demographics** (ZCTA level) — median income, rent, home value, population per ZIP. Feeds the rent model's feature set (`zip_te` currently carries this burden alone), market pages, and investor filters.
3. **Flood / hazard risk** (census-tract level, FEMA NRI) — insurance-relevant risk signal per listing, plus a `census_tract` id on every listing that unlocks future tract-level joins.

## 2. Context (verified seams)

- **Stack:** Postgres 16 + PostGIS (`infrastructure-postgres-1`, container `psql -U postgres`), Python FastAPI scraper (`services/scraper_service/main.py`), Node crawl worker (`apps/worker/src/crawl.ts`), migrations via single-txn runner in `infrastructure/migrations/*.sql` (auto-recorded; CONCURRENTLY/batched work goes in `out-of-band/`), deploys via `rsync` + `/opt/onepercent/infrastructure/deploy.sh <compose args>` on 209.94.61.108.
- **homeharvest 0.8.18** is installed; `scrape_property(listing_type=...)` accepts `'sold'`, and the scraper's `ScrapeRequest.listing_type` (main.py:102) passes straight through. Only the storage branch is missing.
- **Crawl worker** runs three passes per ZIP job — `for_sale`, `for_rent`, `foreclosure` — at crawl.ts:126–146. The ZIP iterator cycles all 31,913 ZIPs in ≈11 days (2,880 jobs/day).
- **`trg_rent_job_enqueue` fires on EVERY INSERT into `listings`** (verified live). This is why sold rows get their own table — inserting them into `listings` would enqueue a rent-calc job per sold transaction.
- **Precedents to copy:** `rental_listings` (separate stream table, scraper branch, dedup index) and `services/ml_rent_estimator/load_hud_safmr.py` + `hud_safmr` (bulk external file → table loader, TSV `\copy` path, dedupe rule, migration + `schema_migrations` insert).
- Existing consumers to wire into: `resolveCosts`/ARV chain in `packages/primitives/src/underwriting.ts` (flip ARV currently: `estimated_value` → comps P75 $/sqft from *asking* comps → null), rent model features in `services/ml_rent_estimator/dataset.py` (feature list + `fit_encoders`), market pages `apps/one/src/app/market/[zipcode]/page.tsx`, detail intel strip in `PropertyOverviewTab.tsx`.

## 3. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sold storage | **New `sold_listings` table** (rental_listings pattern), NOT rows in `listings` | Rent trigger fires per listings-INSERT (verified); `listings` unique key (address, listing_type, sale_type) semantics + every consumer's `listing_type='for_sale'` filters stay untouched; sold rows are immutable transactions, not tracked inventory |
| Sold acquisition | 4th crawl pass `listing_type='sold'`, `past_days=14` | ZIP cycle is ~11 days → 14-day lookback gives overlap without bulk re-pulls; `ON CONFLICT DO NOTHING` on the dedup key absorbs the overlap |
| ACS geography | ZCTA (ZIP-level), ACS 5-year, latest vintage | One API call per variable set returns ALL ZCTAs — no per-row lookups; joins directly on the existing `zip_code` columns |
| ACS auth | Census API key optional (`CENSUS_API_KEY` env); loader works keyless under the daily limit | The full load is a handful of requests; key is a free 1-minute form if ever throttled |
| Flood v1 | **FEMA National Risk Index (NRI), census-tract CSV, bulk** + TIGER tract polygons in PostGIS | Zero per-listing API calls (950K listings × NFHL point queries would be abusive); fully offline + reproducible; also yields `census_tract` on every listing for future joins |
| Flood v2 (explicitly out of scope) | NFHL zone letters (A/AE/X) lazily per listing, cached | Zone letters are the authoritative insurance answer; NRI risk *scores* are the v1 signal. Do not build v2 now — note it in the UI copy ("risk index", not "flood zone") |
| Tract assignment | PostGIS `ST_Contains` on TIGER ZCTA→tract polygons, batch backfill + at-scrape enrichment for new rows | Point-in-polygon is cheap with a GiST index; the proven keyset/SKIP LOCKED backfill pattern applies |

## 4. Non-goals

- No paid data (standing rule). No NFHL zone letters (v2). No AVM/price model itself — this track lands the *training target*; the model is a later cycle. No tract-level ACS (ZCTA only for now — the tract id column future-proofs it). No UI redesigns; only the named surface insertions.

## 5. Schema

```sql
-- B1
CREATE TABLE sold_listings (
  id             BIGSERIAL PRIMARY KEY,
  address        TEXT NOT NULL,
  city           TEXT, state TEXT, zip_code TEXT,
  sold_price     NUMERIC,
  sold_date      DATE,
  list_price     NUMERIC,            -- last ask, when the feed carries it
  bedrooms       NUMERIC(4,1), bathrooms NUMERIC(4,1),
  sqft           INTEGER, year_built INTEGER, lot_sqft NUMERIC,
  property_type  TEXT,
  latitude       NUMERIC(10,7), longitude NUMERIC(10,7),
  geom           geometry(Point, 4326),   -- trigger-maintained like listings
  source         TEXT NOT NULL DEFAULT 'homeharvest',
  raw_data       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_sold_unique ON sold_listings (address, sold_date);
CREATE INDEX idx_sold_geo  ON sold_listings USING gist (geom);
CREATE INDEX idx_sold_zip  ON sold_listings (zip_code, sold_date DESC);

-- B2
CREATE TABLE zcta_demographics (
  zcta              TEXT NOT NULL,
  acs_year          INT  NOT NULL,          -- e.g. 2023 (5-yr vintage end year)
  median_hh_income  NUMERIC,                -- B19013_001E
  median_gross_rent NUMERIC,                -- B25064_001E
  median_home_value NUMERIC,                -- B25077_001E
  population        NUMERIC,                -- B01003_001E
  vacant_units      NUMERIC,                -- B25002_003E
  total_units       NUMERIC,                -- B25002_001E
  PRIMARY KEY (zcta, acs_year)
);

-- B3
CREATE TABLE census_tracts (
  geoid       TEXT PRIMARY KEY,             -- 11-digit tract GEOID
  state_fips  TEXT NOT NULL,
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  -- NRI columns (joined in by the loader; NULL until NRI load runs)
  nri_flood_riverine_score NUMERIC,         -- RFLD_RISKS
  nri_flood_coastal_score  NUMERIC,         -- CFLD_RISKS
  nri_overall_score        NUMERIC,         -- RISK_SCORE
  nri_overall_rating       TEXT             -- RISK_RATNG ('Very Low'..'Very High')
);
CREATE INDEX idx_tracts_geom ON census_tracts USING gist (geom);

ALTER TABLE listings ADD COLUMN IF NOT EXISTS census_tract TEXT;  -- nullable, instant
-- partial index for the backfill marker scan:
--   OOB: CREATE INDEX CONCURRENTLY ... ON listings (id) WHERE census_tract IS NULL AND latitude IS NOT NULL
```

ACS sentinel values: the Census API returns negative sentinels (e.g. `-666666666`) for suppressed cells — the loader MUST null them (`value < 0 → NULL`).

## 6. Workstreams

### B1 — Sold listings capture

1. **Scraper branch** (`services/scraper_service/main.py`): alongside the existing `is_rental` branch (line ~130), add `is_sold = req.listing_type == 'sold'`. Sold rows INSERT into `sold_listings` with `ON CONFLICT (address, sold_date) DO NOTHING`. Field mapping: homeharvest gives `sold_price`, `last_sold_date` (the sale date for sold listings), `list_price`; reuse `extract_enrichment`-style null-hygiene (import the existing `enrichment.py` helpers — don't re-implement `_num`/`_date`). Rows without both `sold_price > 0` and a parseable `sold_date` are skipped and counted.
2. **Geom trigger**: copy the `update_rental_location()` trigger pattern from rental_listings (migration precedent `\d rental_listings`) so `geom` is maintained from lat/lng.
3. **Crawl 4th pass** (`apps/worker/src/crawl.ts:126–146`): `await scrape(job, 'sold', log, { pastDays: 14 })` — extend the `scrape()` helper's options for a per-pass `past_days` override (the others keep the job default). Failure of the sold pass alone must NOT fail the job (same `.catch → null` shape as the foreclosure pass; extend the all-passes-failed check to include it).
4. **Acceptance:** after one deploy + a few crawl ticks: `SELECT count(*), min(sold_date), max(sold_date) FROM sold_listings` growing; dupes impossible (unique index); scraper logs show a `sold` pass per job; `listings` row count growth rate unchanged (no leakage into listings); zero new rent-queue enqueues attributable to sold (rent pending stays ~0).

### B2 — ACS demographics

1. **Loader** `services/ml_rent_estimator/load_acs_zcta.py` (mirror `load_hud_safmr.py`'s shape: `--tsv` mode piped to `\copy`, or direct `DATABASE_URL` upsert):
   - Endpoint: `https://api.census.gov/data/2023/acs/acs5?get=B19013_001E,B25064_001E,B25077_001E,B01003_001E,B25002_001E,B25002_003E&for=zip%20code%20tabulation%20area:*` (+ `&key=$CENSUS_API_KEY` when set). Verify the latest available vintage at execution time (2023 known-good; try 2024 first, fall back).
   - Null the negative sentinels. Expect ≈33K ZCTA rows.
2. **Migration** creates `zcta_demographics`; loader upserts on `(zcta, acs_year)`.
3. **Model feature wiring** (`services/ml_rent_estimator/dataset.py`): LEFT JOIN `zcta_demographics` (latest `acs_year`) in `TRAINING_SQL` on `zip = zcta`; add `median_hh_income` (log) and `median_gross_rent` (log, as an anchor sibling to `hud_anchor_log`) to `FEATURE_NAMES` + `build_feature_row` + imputation stats in `fit_encoders` (median-by-state or global median — pick one, document it). **The nightly retrain gate decides adoption**: if the enriched feature set doesn't beat the incumbent on the eval gate, the promotion simply doesn't happen — no manual rollback path needed. The serving path must supply the same fields: extend `model_store._row_from_request` + the worker batch SELECT to join the same table (mirror how `hud_safmr` is cached in `model_store` — preload the ~33K-row dict, 24h TTL).
4. **Market page**: `/market/[zipcode]` gains an income / rent / home-value / population strip from this table (server-side query; graceful absence).
5. **Acceptance:** row count ≈33K; 3 spot-checked ZIPs match data.census.gov; a training run logs the new features in `metadata.json.feature_names`; market page renders the strip; nightly gate result recorded either way.

### B3 — Tract polygons + NRI flood risk

1. **Tract polygons loader** `infrastructure/scripts/load-census-tracts.sh` (documented, run on the server): download TIGER/Line 2024 tract shapefiles per state (`https://www2.census.gov/geo/tiger/TIGER2024/TRACT/tl_2024_<STATEFIPS>_tract.zip`), `shp2pgsql -s 4269:4326 -I` (reproject NAD83→WGS84) into a staging table, INSERT geoid/state_fips/geom into `census_tracts`. All 50 states + DC ≈ 85K tracts. `shp2pgsql` ships in the postgis container — run the load inside `infrastructure-postgres-1` (files docker-cp'd in), NOT via new host packages.
2. **NRI loader** `services/ml_rent_estimator/load_nri.py`: download the NRI census-tract table CSV (`https://hazards.fema.gov/nri/Content/StaticDocuments/DataDownload/NRI_Table_CensusTracts/NRI_Table_CensusTracts.zip` — verify URL at execution; it moves between NRI releases), parse `TRACTFIPS, RFLD_RISKS, CFLD_RISKS, RISK_SCORE, RISK_RATNG`, UPDATE `census_tracts` by geoid. Expect ≳70K tracts with scores.
3. **Listings tract assignment**:
   - At-scrape: in the scraper's listings INSERT, subquery `(SELECT geoid FROM census_tracts t WHERE ST_Contains(t.geom, ST_SetSRID(ST_MakePoint(%s,%s),4326)) LIMIT 1)` for `census_tract` (lat/lng already computed). Measure the per-row cost on one ZIP first; if it visibly slows the upsert loop, move assignment to a nightly batch instead — decide from the measurement, record the decision.
   - Backfill: OOB keyset procedure (copy `backfill_price_cuts` shape: marker `census_tract IS NULL AND latitude IS NOT NULL`, `FOR UPDATE SKIP LOCKED`, per-batch COMMIT, never touches rent/updated_at columns).
4. **Surface**: detail intel strip gains a risk line when `nri_flood_riverine_score` (or coastal) is meaningful — copy: "Flood risk index: Relatively High (FEMA NRI)" — **"risk index", never "flood zone"** (that's v2/NFHL). `getProperty` joins `census_tracts` via `listings.census_tract`.
5. **Acceptance:** ≥95% of geocoded listings have `census_tract` after backfill; 3 spot-checks (a Houston bayou address should score high riverine, a Denver suburb low); detail page renders the line only when data exists; backfill leaves rent pipeline untouched (pending stays ~0 during run).

### B4 — Sold-comps consumption (ARV truth)

1. **Comps helper**: SQL function or query used by the ARV chain — P75 `sold_price/sqft` from `sold_listings` within 5km (`ST_DWithin` on geom, matching the existing comps route's radius) and 12 months, same property_type, ≥5 comps minimum.
2. **ARV chain upgrade** (`underwriting.ts` + the plumbing in `actions.ts`): flip ARV precedence becomes **sold-comps P75 → estimated_value → asking-comps P75 → null**, with the provenance label extended (`'sold_comps'` — renders "ARV from sold comps"). One-truth rule: the precedence lives in `@oper/primitives`, the SQL that feeds it is parity-tested like `MOTIVATED_SELLER_SCORE_SQL`.
3. **Acceptance:** a flip-strategy scorecard in a sold-dense ZIP shows `ARV from sold comps`; parity test green; thin markets fall through the chain exactly as before.

## 7. Sequencing + effort

```
B1 sold capture (1.5d) ──► B4 ARV consumption (1d, needs ~1 week of sold accrual for rich acceptance)
B2 ACS (1d) ── independent
B3 tracts+NRI (1.5–2d; the TIGER load is the grind) ── independent
```
All three ingest streams can be built in parallel; B4 lands last. ~5 focused days. Each workstream = its own commits with acceptance evidence; single branch `track-b/data-moat`, one PR.

## 8. Risks

| Risk | Mitigation |
|---|---|
| homeharvest `sold` returns thin/empty data for some ZIPs or drops `sold_price` | Skip-and-count rows missing price/date; acceptance measures fill-rate on 3 diverse ZIPs before fleet-wide judgement; the pass is failure-isolated in crawl |
| Sold pass slows ZIP jobs | It's one more HTTP scrape per job (~seconds); crawl duty cycle has headroom (36-pending queue). Measure job duration before/after; if >1.5×, drop sold pass to every-Nth job |
| TIGER/NRI file URLs move between releases | Both loaders take the URL/path as an argument; spec URLs are verified-at-execution hints, not gospel |
| ACS vintage drift / sentinel values | Vintage probe (2024→2023 fallback); sentinel nulling is a MUST in the loader with a unit test |
| ST_Contains at scrape-time slows upserts | Measured on one ZIP first; nightly-batch fallback pre-agreed above |
| New model features regress the model | The existing nightly promotion gate IS the guard — a losing candidate never activates |

## 9. Verification protocol

Per workstream: typecheck/tests locally → migration via runner (OOB by hand) → deploy touched services via `deploy.sh` → live acceptance checks above → evidence appended to `docs/superpowers/plans/track-b-evidence.md` → progress memory update. Standing rules: keyset+SKIP LOCKED for any listings backfill; never write rent columns/updated_at from backfills; n8n freeze not required (no listings schema contention — only a nullable ADD COLUMN).
