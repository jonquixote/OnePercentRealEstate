# Data Expansion v3 — More Rentals, Risk, Neighborhood & Market Signals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow rental training data beyond the single HomeHarvest/realtor.com source, and ingest free federal/open datasets (FHFA, FEMA, NFHL, FBI, EPA, NCES, BLS, GTFS, Walk Score, county GIS) that feed (a) the property page and (b) the rent model — with an explicit placement matrix for each.

**Architecture:** Every new source is a loader that writes to its own Postgres table keyed by a standard geography (`zip5`, county `fips`, tract `geoid`, or PostGIS `geom`), following the existing pattern (`load_acs_zcta.py`, `load_hud_safmr.py`). Rental sources are scraper adapters that normalize into the existing `rental_listings` table with a `source` column. Property-page data is served by one aggregating API route. Model features are added in a **separate, gated wave** at the end, per the rent-v2 discipline (append-only registry, eval gate, atomic promote).

**Tech Stack:** Python 3.14 (ML venv: numpy 2.5.1, pandas 2.3.3), psycopg2, PostGIS, existing scraper_service (FastAPI :8001), HomeHarvest, pg_tileserv, TypeScript worker.

## Global Constraints

- **Free sources only.** Every API in this plan has a $0 tier: FHFA (public CSV), OpenFEMA (no key), NFHL (public downloads), FBI CDE (free key), EPA SLD (public CSV), NCES EDGE (public downloads), BLS v2 (free key, 500 req/day), Walk Score (free key, 5,000 calls/day, **requires attribution + link-back on any page displaying scores**), GTFS (public feeds), Socrata SODA (no key for low volume). No paid data (locked project decision).
- **Large-table discipline:** backfills use keyset batches; never touch `updated_at` on `listings`; wholesale UPDATEs live in `infrastructure/migrations/out-of-band/`, never in the txn migration runner.
- **Feature registry is append-only.** Model features only in Phase M, gated by the existing eval gate (`services/ml_rent_estimator/eval_v1.py`), one retrain per batch, atomic promote. `dataset.py` stays the single feature truth.
- **New env keys** (`WALKSCORE_API_KEY`, `BLS_API_KEY`, `FBI_CDE_API_KEY`) go in `/opt/onepercent/.env`; `ops/systemd/gen-env.sh` deny-list passthrough carries them to `/etc/oper.env` automatically — re-run it + `systemctl daemon-reload` after adding.
- **Scraper adapters** must: set `source` column, respect per-source rate limits with jittered sleeps, dedupe via the frozen address normalization `lower(regexp_replace(trim(address), '\s+', ' ', 'g'))` (defined once in `market_stats.py`, mirrored in SQL — never fork it), and degrade to skip (never crash the crawl loop) on source failure.
- **Loaders are idempotent** (`ON CONFLICT DO UPDATE`) and re-runnable; each prints a one-line JSON summary (`{"done": true, "rows": N}`) so the ml-scheduler can log it.
- **Python deps** go in `services/ml/requirements.txt` (ML venv) or `services/scraper_service/requirements.txt` (scraper venv) — pinned versions, numpy must stay ≥2.x (CPython 3.14 corruption bug with 1.26.x, see requirements comment).

## Placement matrix (what goes where)

| Source | Table | Property page | Model feature (Phase M) |
|---|---|---|---|
| HomeHarvest full capture | `rental_listings`/`listings` +cols | schools, agent, tax history | `nearby_school_rating`, `new_construction` |
| Zumper/PadMapper | `rental_listings` (source='padmapper') | — (training data) | more rows → better TEs |
| FHFA ZIP HPI | `fhfa_zip_hpi` | "5-yr appreciation" stat | `zip_hpi_cagr_5yr` |
| OpenFEMA disasters | `fema_disasters` | Risk panel: disaster history | `disaster_decl_10yr` |
| FEMA NFHL flood zones | `flood_zones` (PostGIS) | Risk panel: flood zone badge | `flood_sfha` (0/1) |
| NRI (already loaded) | `census_tracts.nri_*` | Risk panel: risk scores | already considered, unused |
| FBI CDE crime | `crime_county` | Neighborhood panel: crime idx | `county_crime_rate` |
| Socrata city incidents | deferred (see Deferred section) | — | — |
| EPA Smart Location DB | `epa_walkability` | Neighborhood: walkability | `walkability_index` |
| Walk Score API | `walkscore_cache` | Neighborhood: Walk/Transit/Bike Score® | — (rate-limited, page only) |
| GTFS transit stops | `transit_stops` (PostGIS) | Neighborhood: nearest transit | `transit_stops_1km` |
| NCES schools | `schools` (PostGIS) | Neighborhood: nearby schools | `dist_to_school_km` |
| BLS LAUS | `bls_county_laus` | Market panel: unemployment | `county_unemployment` |
| County parcels (LA ref.) | `parcels` (PostGIS) | Lot outline on map, assessed detail | — (single county, page only) |

---

## Phase R — More rentals (the headline requirement)

### Task R1: HomeHarvest full capture — stop throwing fields away

We call `scrape_property(..., extra_property_data=True)` but persist only a subset. HomeHarvest returns (per its schema): `neighborhoods, county, fips_code, stories, parking_garage, agent_name, agent_email, agent_phones, broker_name, office_name, office_phones, nearby_schools, alt_photos, new_construction, assessed_value, estimated_value, tax, tax_history, hoa_fee, days_on_mls, price_per_sqft, last_sold_date, sold_price, mls, mls_id, text (description)`. Several are model-relevant; `nearby_schools` is a free per-listing school-quality signal we currently discard.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_homeharvest_full_capture.sql`
- Modify: `services/scraper.py` (the row-normalization dict, around line 160-200)
- Test: `services/scraper_service/test_normalize.py` (create)

**Interfaces:**
- Produces: columns `listings.county_fips TEXT`, `listings.neighborhoods TEXT`, `listings.stories REAL`, `listings.parking_garage REAL`, `listings.new_construction BOOLEAN`, `listings.nearby_schools JSONB`, `listings.agent_info JSONB`, `listings.tax_history JSONB`; same on `rental_listings` where applicable (`county_fips, neighborhoods, nearby_schools`).
- The normalization function must remain a pure `row -> dict` so it is unit-testable without the network.

- [ ] **Step 1: Migration** — add the columns (all nullable, `IF NOT EXISTS`) to both tables:

```sql
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS county_fips TEXT,
  ADD COLUMN IF NOT EXISTS neighborhoods TEXT,
  ADD COLUMN IF NOT EXISTS stories REAL,
  ADD COLUMN IF NOT EXISTS parking_garage REAL,
  ADD COLUMN IF NOT EXISTS new_construction BOOLEAN,
  ADD COLUMN IF NOT EXISTS nearby_schools JSONB,
  ADD COLUMN IF NOT EXISTS agent_info JSONB,
  ADD COLUMN IF NOT EXISTS tax_history JSONB;

ALTER TABLE rental_listings
  ADD COLUMN IF NOT EXISTS county_fips TEXT,
  ADD COLUMN IF NOT EXISTS neighborhoods TEXT,
  ADD COLUMN IF NOT EXISTS nearby_schools JSONB,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'homeharvest';
CREATE INDEX IF NOT EXISTS idx_rental_listings_source ON rental_listings (source);
```

- [ ] **Step 2: Extract normalization into a pure function.** In `services/scraper.py`, the per-row dict construction moves into `def normalize_row(row: dict, listing_type: str) -> dict` at module level (no DB, no network). Add the new fields:

```python
"county_fips": str(row["fips_code"]) if pd.notna(row.get("fips_code")) else None,
"neighborhoods": str(row["neighborhoods"]) if pd.notna(row.get("neighborhoods")) else None,
"stories": float(row["stories"]) if pd.notna(row.get("stories")) else None,
"parking_garage": float(row["parking_garage"]) if pd.notna(row.get("parking_garage")) else None,
"new_construction": bool(row["new_construction"]) if pd.notna(row.get("new_construction")) else None,
"nearby_schools": json.dumps(row["nearby_schools"]) if isinstance(row.get("nearby_schools"), (list, dict)) else None,
"agent_info": json.dumps({k: row.get(k) for k in ("agent_name","agent_email","broker_name","office_name") if pd.notna(row.get(k))}) or None,
"tax_history": json.dumps(row["tax_history"]) if isinstance(row.get("tax_history"), (list, dict)) else None,
```

Guard: `agent_info` only on `listings` (for-sale); `nearby_schools` on both.

- [ ] **Step 3: `extra_property_data=True` for ALL listing types**, not just the current conditional (line ~292). Sold + for_sale + for_rent all benefit (tax_history on solds feeds P2-style features later).
- [ ] **Step 4: Tests** — `test_normalize.py` with three fixture rows (for_sale with schools+tax_history, for_rent minimal, sold with NaNs everywhere) asserting: JSONB fields serialize, NaN → None, `fips_code` stringified with leading zeros preserved, unknown keys ignored.
- [ ] **Step 5:** Run migration on server, deploy scraper, `systemctl restart oper-scraper`, trigger one crawl job, verify: `SELECT count(nearby_schools) FROM listings WHERE created_at > now() - interval '1 hour';` > 0. Commit.

### Task R2: HomeHarvest `pending` pass + windowed backfill mode

**Files:**
- Modify: `services/scraper.py` (task list construction ~line 267), `apps/worker/src/crawl.ts` (add fifth pass)

- [ ] Add a `pending` scrape pass in `crawl.ts` (same shape as the `sold` pass, `listing_type: 'pending'`, catch-and-continue). Pending listings are leading inventory signal and often carry full detail.
- [ ] Add `--date_from/--date_to` passthrough in `scraper.py` mapping to HomeHarvest's `date_from`/`date_to` kwargs, so historical rental backfills can walk month-windows instead of `past_days` only: `python -m scraper --location 90004 --listing_type for_rent --date_from 2025-01-01 --date_to 2025-02-01`.
- [ ] Acceptance: one crawl job log shows 5 passes; a manual windowed run inserts rentals with `listing_date` inside the window. Commit.

### Task R3: PadMapper/Zumper adapter — second rental source

PadMapper (owned by Zumper) exposes the JSON endpoint its own map uses: `POST https://www.padmapper.com/api/t/1/pages/listables` with a bbox payload — no auth, returns `listables[]` with `{min_price, max_price, min_bedrooms, min_bathrooms, min_square_feet, lat, lng, address_lines/formatted_address, listing_type, building_name, pet policies}`. This is public data from a public endpoint, same posture as HomeHarvest scraping realtor.com. Be a polite client: ≤1 req/2s jittered, identify a stable UA, stop on 403/429 for the rest of the run.

**Files:**
- Create: `services/scraper_service/adapters/padmapper.py`
- Create: `services/scraper_service/adapters/__init__.py`
- Modify: `services/scraper_service/app.py` (or wherever the FastAPI `/scrape` route lives — it must gain `source: str = "homeharvest"` in the request model and dispatch)
- Test: `services/scraper_service/test_padmapper.py`

**Interfaces:**
- Produces: `fetch_bbox(min_lat, min_lng, max_lat, max_lng, *, session) -> list[dict]` (raw listables) and `normalize(listable: dict) -> dict | None` (rental_listings-shaped dict with `source='padmapper'`, or None when unmappable — no address, price outside 300..20000, or missing lat/lng).
- The `/scrape` route with `{"source": "padmapper", "location": "<zip>"}` geocodes the ZIP to a bbox using the existing ZCTA geometries (`SELECT ST_XMin/ST_YMin/ST_XMax/ST_YMax FROM zcta_geometries WHERE zcta = %s` — check actual table name with `\dt *zcta*` before coding) and runs fetch+normalize+upsert.

- [ ] **Step 1: Write `normalize()` tests first** — fixtures for: complete listable → full dict; missing address → None; price 150 → None (below floor); price range uses `min_price`; `source == 'padmapper'`.
- [ ] **Step 2: Implement `normalize()`** mapping: `min_price→price`, `min_bedrooms→bedrooms`, `min_bathrooms→bathrooms`, `min_square_feet→sqft`, `formatted_address→address` (fall back to `building_name + city`), `lat/lng→latitude/longitude`. `listing_date = today`. Run tests → PASS.
- [ ] **Step 3: Implement `fetch_bbox()`** with `httpx` (already in scraper venv; verify with `pip show httpx`, else add pinned), 15s timeout, one retry on 5xx, hard stop on 403/429 raising `SourceBlockedError`.
- [ ] **Step 4: Wire the dispatch** in the FastAPI route; upsert path reuses the existing rental_listings upsert (address+listing_date conflict key — read the existing `ON CONFLICT` clause in `scraper.py` and match it exactly).
- [ ] **Step 5: Cross-source dedupe guard.** Before insert, skip when an address-normalized match exists in the last 14 days from ANY source: `SELECT 1 FROM rental_listings WHERE lower(regexp_replace(trim(address), '\s+', ' ', 'g')) = %s AND listing_date > now() - interval '14 days' LIMIT 1`. (Prefer HomeHarvest rows: run padmapper AFTER the homeharvest pass in the crawler.)
- [ ] **Step 6: Crawler pass.** `crawl.ts` gains a sixth pass: `scrape(job, 'for_rent', log, { source: 'padmapper' })`, catch-and-continue like the others.
- [ ] **Step 7: Live verify** on one dense ZIP (90004): run the pass, then `SELECT source, count(*) FROM rental_listings WHERE listing_date = current_date GROUP BY 1;` shows both sources. Commit.

### Task R4: Rental source observability

**Files:**
- Modify: `infrastructure/monitoring/postgres-exporter/queries.yml`
- Modify: `infrastructure/monitoring/prometheus/rules/alerts.yml`

- [ ] Add exporter query `rental_ingest_by_source`: `SELECT source, count(*) FILTER (WHERE listing_date > now() - interval '24 hours') AS last24h FROM rental_listings GROUP BY source` → gauge with `source` label.
- [ ] Alert `RentalIngestStalled`: `sum(rental_ingest_by_source_last24h) < 100` for 6h → warn (we currently ingest ~600+/day; 100 means the pipeline is sick).
- [ ] Restart postgres-exporter + verify series in Prometheus. Commit.

---

## Phase D — Bulk open-data loaders (each independent; parallelizable)

Every loader lives in `services/ml_rent_estimator/` beside `load_acs_zcta.py`, runs inside the ML venv (`/opt/onepercent/services/ml/.venv/bin/python -m ml_rent_estimator.<loader>`), reads `DATABASE_URL`, and is idempotent. Each task = migration + loader + acceptance query + commit.

### Task D1: FHFA ZIP-level House Price Index

FHFA publishes annual HPI at 5-digit ZIP (Developmental Index, CSV: `https://www.fhfa.gov/hpi/download/annually/hpi_at_bdl_zip5.csv` — verify the current filename at fhfa.gov/data/hpi/datasets → "Annual House Price Indexes → ZIP5"; it changes occasionally).

**Files:**
- Create: `infrastructure/migrations/2026_07_11_fhfa_zip_hpi.sql`
- Create: `services/ml_rent_estimator/load_fhfa_hpi.py`
- Test: `services/ml_rent_estimator/test_load_fhfa.py`

```sql
CREATE TABLE IF NOT EXISTS fhfa_zip_hpi (
  zip5 TEXT NOT NULL,
  year INT NOT NULL,
  hpi REAL,               -- index, base varies by series; comparisons are within-zip
  annual_change_pct REAL,
  PRIMARY KEY (zip5, year)
);
```

**Interfaces:** loader downloads CSV (columns: `Five-Digit ZIP Code, Year, Annual Change (%), HPI, HPI with 1990 base, HPI with 2000 base` — parse by header names, not positions), upserts. `main()` accepts `--csv PATH` for offline/test runs.

- [ ] Test: fixture CSV with 3 rows incl. a `.` (missing) annual change → parses, missing → None, zip zero-padded.
- [ ] Implement; run on server; acceptance: `SELECT count(DISTINCT zip5) FROM fhfa_zip_hpi;` ≥ 15,000 and max(year) ≥ 2024. Commit.

### Task D2: EPA Smart Location Database — national walkability index

EPA SLD v3 has a **National Walkability Index** for every census block group, free bulk CSV (epa.gov/smartgrowth/smart-location-mapping — "Walkability Index" download). This covers 100% of listings with zero rate limits — it is the MODEL's walkability signal; Walk Score (D8) is the PAGE's.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_epa_walkability.sql`
- Create: `services/ml_rent_estimator/load_epa_walkability.py`

```sql
CREATE TABLE IF NOT EXISTS epa_walkability (
  geoid_bg TEXT PRIMARY KEY,      -- 12-digit block group
  natwalkind REAL,                -- 1..20
  d2a_ephhm REAL,                 -- employment+household entropy (mix)
  d3b REAL,                       -- street intersection density
  d4a REAL                        -- distance to nearest transit (m; -99999 = none)
);
```

- [ ] Loader: stream the CSV (it is ~220MB; use `pandas.read_csv(chunksize=100_000, usecols=[...])`), upsert per chunk. Tract rollup view for the model: `CREATE OR REPLACE VIEW tract_walkability AS SELECT left(geoid_bg, 11) AS geoid, avg(natwalkind) AS natwalkind FROM epa_walkability GROUP BY 1;` (in the same migration).
- [ ] Acceptance: `SELECT count(*) FROM epa_walkability;` ≥ 200,000; `SELECT natwalkind FROM tract_walkability WHERE geoid='06037211500';` returns 14-18 (Koreatown is highly walkable — sanity anchor). Commit.

### Task D3: NCES school locations

NCES EDGE publishes geocoded public schools (`https://nces.ed.gov/programs/edge/geographic/schoollocations` — CSV/shapefile per year). Load points only; ratings come from HomeHarvest `nearby_schools` (R1).

**Files:**
- Create: `infrastructure/migrations/2026_07_11_schools.sql`
- Create: `services/ml_rent_estimator/load_nces_schools.py`

```sql
CREATE TABLE IF NOT EXISTS schools (
  ncessch TEXT PRIMARY KEY,
  name TEXT,
  level TEXT,              -- 'Elementary'|'Middle'|'High'|'Other'
  geom GEOMETRY(Point, 4326)
);
CREATE INDEX IF NOT EXISTS idx_schools_geom ON schools USING GIST (geom);
```

- [ ] Loader parses the EDGE public-school CSV (`LAT`, `LON`, `NCESSCH`, `NAME`, `LEVEL` columns), `ST_SetSRID(ST_MakePoint(lon,lat),4326)`.
- [ ] Acceptance: ≥ 95,000 rows; `SELECT count(*) FROM schools WHERE ST_DWithin(geom::geography, ST_MakePoint(-118.31,34.076)::geography, 1600);` ≥ 3. Commit.

### Task D4: OpenFEMA disaster declarations

No key. `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=declarationDate ge '2015-01-01'&$select=fipsStateCode,fipsCountyCode,incidentType,declarationDate,fyDeclared&$top=10000&$skip=N` (paginate by `$skip` until empty).

**Files:**
- Create: `infrastructure/migrations/2026_07_11_fema_disasters.sql`
- Create: `services/ml_rent_estimator/load_fema_disasters.py`

```sql
CREATE TABLE IF NOT EXISTS fema_disasters (
  fips TEXT NOT NULL,             -- 5-digit state+county
  fy INT NOT NULL,
  incident_type TEXT NOT NULL,    -- 'Flood','Fire','Hurricane','Severe Storm',...
  declarations INT NOT NULL,
  PRIMARY KEY (fips, fy, incident_type)
);
```

- [ ] Loader aggregates per (fips, fy, incident_type); fips = `fipsStateCode + fipsCountyCode` zero-padded. County code `000` (statewide) rows: skip.
- [ ] Acceptance: ≥ 20,000 rows; `SELECT sum(declarations) FROM fema_disasters WHERE fips='06037';` > 0 (LA county has declarations). Commit.

### Task D5: BLS LAUS county unemployment (API v2)

Free key at data.bls.gov/registrationEngine (env `BLS_API_KEY`). Series id pattern: `LAUCN{fips}0000000003` (unemployment rate). 500 req/day, 50 series/request → ~65 requests covers all ~3,200 counties. Run monthly.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_bls_laus.sql`
- Create: `services/ml_rent_estimator/load_bls_laus.py`
- Modify: `apps/worker/src/ml-scheduler.ts` (monthly job, 1st of month 02:30 UTC, POST a new ML endpoint `/ops/load-bls` — copy the `/ops/refresh-market-stats` in-process endpoint shape in `services/ml/main.py`, subprocess via `sys.executable`, NEVER bare `python`)

```sql
CREATE TABLE IF NOT EXISTS bls_county_laus (
  fips TEXT NOT NULL,
  period DATE NOT NULL,           -- first of month
  unemployment_rate REAL,
  PRIMARY KEY (fips, period)
);
```

- [ ] Loader: batch 50 series per POST to `https://api.bls.gov/publicAPI/v2/timeseries/data/` with `registrationkey`, `startyear/endyear` = trailing 24 months; county fips list from `SELECT DISTINCT left(geoid,5) FROM census_tracts`. Handle `REQUEST_NOT_PROCESSED` (daily cap) by stopping cleanly and resuming next run (upsert makes this safe).
- [ ] Acceptance: ≥ 2,500 counties with a row in the last 3 months. Commit.

### Task D6: FEMA NFHL flood zones (top listing states)

The full NFHL is ~100GB; load only SFHA polygons for the top-10 states by listing count (`SELECT state, count(*) FROM listings GROUP BY 1 ORDER BY 2 DESC LIMIT 10`). Per-state GDBs: `https://hazards.fema.gov/nfhlv2/output/State/` (e.g. `NFHL_06_*.zip` for CA). Layer `S_FLD_HAZ_AR`, fields `FLD_ZONE`, `SFHA_TF`.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_flood_zones.sql`
- Create: `services/ml_rent_estimator/load_nfhl.py`
- Modify: `services/ml/requirements.txt` (add pinned `fiona` or use `ogr2ogr` — **prefer `ogr2ogr` via `apt install gdal-bin` on the server: zero Python deps**, loader shells out)

```sql
CREATE TABLE IF NOT EXISTS flood_zones (
  id BIGSERIAL PRIMARY KEY,
  state_fips TEXT NOT NULL,
  fld_zone TEXT NOT NULL,          -- 'AE','VE','A','X',...
  sfha BOOLEAN NOT NULL,           -- Special Flood Hazard Area
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flood_zones_geom ON flood_zones USING GIST (geom);
```

- [ ] Loader per state: download zip → `ogr2ogr -f PostgreSQL PG:"$DATABASE_URL" -nln flood_zones_staging -t_srs EPSG:4326 <gdb> S_FLD_HAZ_AR`, then `INSERT INTO flood_zones ... SELECT ... WHERE sfha_tf = 'T' OR fld_zone IN ('AE','VE','A','AO','AH')` and drop staging. Only SFHA + named zones — keeps the table ~5-10GB total. **Disk check first**: `df -h /` must show ≥ 30GB free before each state; abort otherwise.
- [ ] Point lookup helper (used by page API + Phase M): `CREATE OR REPLACE FUNCTION flood_zone_at(lat float, lng float) RETURNS TABLE(fld_zone text, sfha boolean) AS $$ SELECT fld_zone, sfha FROM flood_zones WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326)) LIMIT 1 $$ LANGUAGE sql STABLE;`
- [ ] Acceptance: `SELECT flood_zone_at(29.76, -95.36);` (Houston) returns a row for at least one test point; query planner uses the GIST index (`EXPLAIN` shows Index Scan). Commit per state; states can load incrementally over several nights.

### Task D7: FBI Crime Data Explorer — county-level rates

Free key at api.data.gov (env `FBI_CDE_API_KEY`). Agency-level offense counts: `https://api.usa.gov/crime/fbi/cde/summarized/agency/{ori}/{offense}?from=...&to=...&API_KEY=...`; agency→county via the agencies endpoint (`/agency/byStateAbbr/{state}` returns `ori, county_name, latitude, longitude`). County rate = sum(agency offenses)/county population (population from `tract_demographics` rollup).

**Files:**
- Create: `infrastructure/migrations/2026_07_11_crime_county.sql`
- Create: `services/ml_rent_estimator/load_fbi_crime.py`

```sql
CREATE TABLE IF NOT EXISTS crime_county (
  fips TEXT NOT NULL,
  year INT NOT NULL,
  violent_per_100k REAL,
  property_per_100k REAL,
  agencies_reporting INT,
  PRIMARY KEY (fips, year)
);
```

- [ ] Loader: for the top-15 listing states, fetch agencies once (cache to `/tmp`), fetch `violent-crime` and `property-crime` summaries for latest complete year, aggregate by county name→fips (join through a static county-name lookup built from `census_tracts` — county name needs the Census counties file `https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt`; load it into the loader as a dict, not a table).
- [ ] Rows with `agencies_reporting < 1` are not written. This data is APPROXIMATE (UCR participation gaps) — the page copy must say "FBI-reported, coverage varies"; the loader writes `agencies_reporting` so the page can suppress low-coverage counties (< 2 agencies).
- [ ] Acceptance: ≥ 800 counties for the latest year; LA county violent rate between 300-800/100k (sanity band). Commit.

### Task D8: Walk Score API cache (page display only)

Free key (walkscore.com/professional — 5,000/day). **Contract requirements:** display "Walk Score®" branding, link to the walkscore.com page for the address, do not store scores > 30 days. The cache TTL enforces the storage term.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_walkscore_cache.sql`
- Create: `apps/one/src/lib/walkscore.ts` (server-side fetch + cache; the Next app already talks to Postgres — follow `apps/one/src/lib/` db util patterns)

```sql
CREATE TABLE IF NOT EXISTS walkscore_cache (
  addr_norm TEXT PRIMARY KEY,
  walk INT, transit INT, bike INT,
  ws_link TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Interfaces:** `getWalkScore(address: string, lat: number, lng: number): Promise<{walk?: number; transit?: number; bike?: number; link?: string} | null>` — returns cache if `fetched_at > now()-'30 days'`, else fetches `https://api.walkscore.com/score?format=json&address=...&lat=...&lon=...&transit=1&bike=1&wsapikey=$WALKSCORE_API_KEY`, upserts, returns. On 40x/quota: return null (page hides the widget).

- [ ] Implement + unit test the cache-hit/expiry logic with an injected fetcher. Acceptance: property page API (Phase P) returns scores for a known LA address on second call without hitting the API (verify by counter in the injected fetcher). Commit.

### Task D9: GTFS transit stops (metro coverage)

Feeds from the Mobility Database catalog (`https://files.mobilitydatabase.org/feeds_v2.csv` — filter `status=active, country_code=US`, take the ~40 largest by metro). Each GTFS zip has `stops.txt` (`stop_id, stop_lat, stop_lon`) and `routes.txt` (`route_type`: 0-2 = rail/subway/tram, 3 = bus).

**Files:**
- Create: `infrastructure/migrations/2026_07_11_transit_stops.sql`
- Create: `services/ml_rent_estimator/load_gtfs.py`

```sql
CREATE TABLE IF NOT EXISTS transit_stops (
  feed TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  route_types INT[] NOT NULL DEFAULT '{}',
  geom GEOMETRY(Point, 4326) NOT NULL,
  PRIMARY KEY (feed, stop_id)
);
CREATE INDEX IF NOT EXISTS idx_transit_stops_geom ON transit_stops USING GIST (geom);
```

- [ ] Loader: hardcode an initial feed list (LA Metro, NYC MTA subway+bus, CTA, MBTA, SEPTA, WMATA, Metro Transit MN, TriMet, King County Metro, MARTA, DART, Houston Metro, Denver RTD, Miami-Dade) with direct GTFS zip URLs in a `FEEDS: dict[str, str]` constant; per feed: download, join stops↔stop_times↔trips↔routes is overkill — join `stops.txt` to route_type via `stop_times.txt`→`trips.txt` only if the files are < 200MB, else store stops with empty route_types.
- [ ] Acceptance: ≥ 60,000 stops; `SELECT count(*) FROM transit_stops WHERE ST_DWithin(geom::geography, ST_MakePoint(-118.31,34.076)::geography, 800);` ≥ 5. Commit.

### Task D10: LA County parcel adapter (reference implementation for county GIS)

LA County parcels are public ArcGIS FeatureServer (`https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcels/MapServer` — verify current URL; query with `f=geojson&where=1=1&resultOffset=N`). This task builds the PATTERN (adapter interface + table) with one county; more counties are follow-up work, not this plan.

**Files:**
- Create: `infrastructure/migrations/2026_07_11_parcels.sql`
- Create: `services/ml_rent_estimator/load_parcels_la.py`

```sql
CREATE TABLE IF NOT EXISTS parcels (
  county_fips TEXT NOT NULL,
  apn TEXT NOT NULL,
  situs_addr_norm TEXT,
  assessed_land REAL,
  assessed_improvements REAL,
  geom GEOMETRY(MultiPolygon, 4326),
  PRIMARY KEY (county_fips, apn)
);
CREATE INDEX IF NOT EXISTS idx_parcels_geom ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_parcels_addr ON parcels (situs_addr_norm);
```

- [ ] Loader pages the FeatureServer 1,000 records at a time (`resultOffset`), normalizes situs address with the frozen expression, upserts. LA has ~2.4M parcels → run in background, resumable via `--offset`.
- [ ] "OpenFEMA + county GIS combined" deliverable: `CREATE OR REPLACE VIEW parcel_flood_exposure AS SELECT p.county_fips, p.apn, ST_Area(ST_Intersection(p.geom, f.geom)) / NULLIF(ST_Area(p.geom),0) AS pct_in_sfha FROM parcels p JOIN flood_zones f ON ST_Intersects(p.geom, f.geom) WHERE f.sfha;` — property page can show "38% of this parcel is in flood zone AE".
- [ ] Acceptance: ≥ 2M parcels; a known LA address matches by `situs_addr_norm`. Commit.

---

## Phase P — Property page integration (one aggregating endpoint)

### Task P1: `/api/properties/[id]/context` route

**Files:**
- Create: `apps/one/src/app/api/properties/[id]/context/route.ts`
- Test: `apps/one/src/app/api/properties/[id]/context/route.test.ts` (if the app has a vitest setup — check `apps/one/package.json` scripts; else acceptance is curl-based)

**Interfaces (the response contract the page components consume):**

```typescript
interface PropertyContext {
  risk: {
    nri_overall_score: number | null; nri_overall_rating: string | null;
    nri_flood_riverine: number | null; nri_flood_coastal: number | null;
    flood_zone: string | null; flood_sfha: boolean | null;
    disasters_10yr: Array<{ incident_type: string; declarations: number }>;
    parcel_pct_in_sfha: number | null;   // null unless county loaded (D10)
  };
  neighborhood: {
    walkability_index: number | null;                    // EPA, always
    walkscore: { walk: number; transit: number; bike: number; link: string } | null;  // WS API, page-only
    transit_stops_800m: number; nearest_rail_km: number | null;
    schools_1600m: Array<{ name: string; level: string; dist_km: number }>;
    hh_nearby_schools: unknown | null;                   // raw JSONB from listing
    crime: { violent_per_100k: number; property_per_100k: number; coverage_note: string } | null;
  };
  market: {
    zip_hpi_cagr_5yr: number | null; zip_hpi_series: Array<{ year: number; hpi: number }>;
    county_unemployment: number | null; county_unemployment_period: string | null;
  };
}
```

- [ ] One route, one connection, parallel queries (`Promise.all`) against: `census_tracts` (join via `listings.census_tract`), `flood_zone_at(lat,lng)`, `fema_disasters` (last 10 fy), `tract_walkability`, `getWalkScore()`, `transit_stops` (ST_DWithin 800m; nearest with `route_types && '{0,1,2}'`), `schools` (1600m, ordered), `crime_county` (suppress when `agencies_reporting < 2` → null + note), `fhfa_zip_hpi` (10-yr series + CAGR calc), `bls_county_laus` (latest).
- [ ] Every sub-source failure degrades to null — never 500 the panel. 60s `revalidate` cache.
- [ ] Acceptance: `curl /api/properties/<id>/context | jq` returns the full shape for an LA listing with non-null risk + walkability. Commit.

### Task P2: Page panels

**Files:**
- Create: `apps/one/src/components/property/sections/RiskPanel.tsx`
- Create: `apps/one/src/components/property/sections/NeighborhoodPanel.tsx`
- Create: `apps/one/src/components/property/sections/MarketContextPanel.tsx`
- Modify: `apps/one/src/app/property/[id]/page.tsx` (mount panels; fetch context server-side)

- [ ] Match the existing section components' style in `apps/one/src/components/property/sections/` (read two of them first; reuse their card/heading primitives — the app is the dark "line" motif design).
- [ ] RiskPanel: NRI rating chip (color by rating), flood zone badge (red when `sfha`), disasters-by-type bars, parcel exposure line when present.
- [ ] NeighborhoodPanel: EPA walkability dial (1-20), Walk Score® row **with required attribution + link**, transit summary, schools list, crime row with coverage note, HomeHarvest schools when present.
- [ ] MarketContextPanel: HPI sparkline (reuse `PriceSparkline.tsx` pattern), 5-yr CAGR stat, unemployment stat.
- [ ] All panels render skeleton → data, and render nothing (not an empty card) when their whole section is null. Commit per panel.

---

## Phase M — Model features (gated wave, LAST)

Follows rent-v2 discipline exactly: append to `FEATURE_NAMES`, compute in `compute_features()`, bake lookup dicts into `fit_encoders()` meta, retrain → eval gate → promote. **One batch, one retrain.** If the gate fails, ship page-only and stop.

### Task M1: Feature plumbing

**Files:**
- Modify: `services/ml_rent_estimator/dataset.py`
- Modify: `services/ml_rent_estimator/train_v1.py` (loaders for the new meta dicts, following `load_market_stats`/`load_tract_income` in the same file)
- Modify: `services/ml_rent_estimator/test_dataset.py`

**Interfaces:** `FEATURE_NAMES` appends, in order: `"zip_hpi_cagr_5yr", "walkability_index", "county_unemployment", "disaster_decl_10yr", "flood_sfha", "transit_stops_1km", "county_crime_rate"`. Meta gains dicts: `hpi_cagr: {zip5: float}`, `tract_walk: {geoid: float}`, `county_unemp: {fips: float}`, `county_disasters: {fips: float}`, `county_crime: {fips: float}`; `flood_sfha` and `transit_stops_1km` are computed per-row at training time via SQL columns added to `TRAINING_SQL` (lateral `flood_zone_at` is too slow for 350K rows — precompute both onto `rental_listings` in an out-of-band keyset backfill: `rental_listings.flood_sfha BOOLEAN`, `rental_listings.transit_stops_1km INT`, nightly increment in ml-scheduler; serving reads the same columns from the worker payload with 0-sentinel fallback).

- [ ] Sentinels: missing → 0.0 for all (LightGBM splits sentinels fine; document in the registry comment). `county_fips` derives from `census_tract[:5]` — no new plumbing.
- [ ] Tests: each feature computes from meta fixtures; missing tract/zip/fips falls back to sentinel; `len(FEATURE_NAMES)` asserted (33 + 7 = 40); vector emission still follows artifact meta order (serve-old-model test must keep passing untouched).
- [ ] Commit.

### Task M2: Retrain + gate + promote + verify

- [ ] Backfills first (out-of-band, keyset): `flood_sfha`, `transit_stops_1km` on `rental_listings` for geocoded rows in loaded states.
- [ ] `curl -X POST localhost:8000/ops/run-train` (or wait for the nightly). Gate must pass: overall ratio, highvar non-regression, spearman, band 0.78-0.84, fmr_cagr ≥ 0.5.
- [ ] Inspect `importances_top20` in the new eval report: expect `walkability_index` and `zip_hpi_cagr_5yr` to appear; if all 7 new features have ~0 gain, revert the batch (they're noise) rather than carrying dead features.
- [ ] Update `docs/superpowers/specs/2026-07-08-rent-model-v2-final.md` acceptance table with the new baseline. Commit + push.

---

## Explicitly deferred (named in the request, deliberately not in this plan)

- **Local police open-data portals** (Socrata city incident feeds): every city's schema differs; national coverage never converges. The pattern is one adapter per city writing `crime_incidents(city, occurred_at, category, geom)` — build the first (LA: `data.lacity.org/resource/2nrs-mtv8.json`, SODA, no key at low volume) only AFTER D7's county layer ships and the page proves demand for block-level detail. County-level FBI (D7) covers the model.
- **State department of education ratings**: 50 bespoke portals with incompatible rating scales. HomeHarvest's `nearby_schools` (captured in R1) already carries realtor.com's per-listing school ratings for free; NCES (D3) covers locations. Revisit only if HH school data proves too sparse (< 40% of listings).
- **Zillow-unofficial (`pyzill`-style) rental adapter**: legally the same posture as HomeHarvest but a much more hostile anti-bot target (PerimeterX). PadMapper (R3) is the better second source; consider Zillow only if R3 lands < 200 rentals/day.

## Execution order & independence

```
R1 → R2 → R3 → R4        (rentals first — compounding training data)
D1..D10 in any order      (each standalone; D6 NFHL before D10's exposure view)
P1 → P2                   (needs whichever D-tables exist; degrades for the rest)
M1 → M2                   (LAST, after D-tables verified populated)
```

Acceptance summary: rentals/day from ≥ 2 sources visible in Prometheus; property page shows risk + neighborhood + market panels for an LA listing; model gate passes with ≥ 1 new feature in top-20 importances (or batch reverted deliberately).
