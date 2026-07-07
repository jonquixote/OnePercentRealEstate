-- OnePercentRealEstate — base schema for self-hosted Postgres 16 + PostGIS 3.4
-- Generated from codebase column references (actions.ts, scraper_service/main.py, scraper.py,
-- schema_v2.sql, rental_schema_upgrade.sql, add_performance_indexes.sql, phase1_geometry_migration.sql)
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================
-- LISTINGS — primary for-sale property table
-- =========================================================================
CREATE TABLE IF NOT EXISTS listings (
    id              BIGSERIAL PRIMARY KEY,
    address         TEXT NOT NULL,
    city            TEXT,
    state           TEXT,
    zip_code        TEXT,
    price           NUMERIC(12, 2),
    bedrooms        NUMERIC(4, 1),
    bathrooms       NUMERIC(4, 1),
    sqft            INTEGER,
    year_built      INTEGER,
    property_type   TEXT,
    listing_type    TEXT NOT NULL DEFAULT 'for_sale',
    images          JSONB DEFAULT '[]'::jsonb,
    primary_photo   TEXT,
    raw_data        JSONB DEFAULT '{}'::jsonb,
    latitude        NUMERIC(10, 7),
    longitude       NUMERIC(10, 7),
    geom            GEOMETRY(POINT, 4326),
    status          TEXT NOT NULL DEFAULT 'watch',
    listing_status  TEXT NOT NULL DEFAULT 'watch',
    user_id         TEXT,
    estimated_rent  NUMERIC(10, 2),
    mls_id          TEXT,
    mls_status      TEXT,
    days_on_market  INTEGER,
    hoa_fee         NUMERIC(10, 2),
    tax_annual_amount NUMERIC(12, 2),
    agent_name      TEXT,
    agent_email     TEXT,
    agent_phone     TEXT,
    broker_name     TEXT,
    lot_size_acres  NUMERIC(10, 4),
    stories         INTEGER,
    garage_spaces   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT listings_address_listing_type_uniq UNIQUE (address, listing_type)
);

CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_lat_lon ON listings(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_listings_created_desc ON listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_type_created ON listings(listing_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_beds_baths ON listings(bedrooms, bathrooms);
CREATE INDEX IF NOT EXISTS idx_listings_zip ON listings(zip_code);
CREATE INDEX IF NOT EXISTS idx_listings_city_state ON listings(city, state);
CREATE INDEX IF NOT EXISTS idx_listings_mls_status ON listings(mls_status);
CREATE INDEX IF NOT EXISTS idx_listings_mls_id ON listings(mls_id);
CREATE INDEX IF NOT EXISTS idx_listings_broker_name ON listings(broker_name);
CREATE INDEX IF NOT EXISTS idx_listings_geom ON listings USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_listings_geom_type ON listings USING GIST(geom)
    WHERE listing_type = 'for_sale' AND geom IS NOT NULL;
CREATE INDEX IF NOT EXISTS listings_rent_price_ratio_idx ON listings (rent_price_ratio DESC)
    WHERE rent_price_ratio IS NOT NULL;

-- Trigger to keep geom in sync with lat/lon
CREATE OR REPLACE FUNCTION update_listings_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude::float, NEW.latitude::float), 4326);
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_listings_geom ON listings;
CREATE TRIGGER trg_update_listings_geom
    BEFORE INSERT OR UPDATE OF longitude, latitude, geom ON listings
    FOR EACH ROW
    EXECUTE FUNCTION update_listings_geom();

-- =========================================================================
-- RENTAL_LISTINGS — for ML training of rent estimator
-- =========================================================================
CREATE TABLE IF NOT EXISTS rental_listings (
    id              BIGSERIAL PRIMARY KEY,
    address         TEXT NOT NULL,
    city            TEXT,
    state           TEXT,
    zip_code        TEXT,
    price           NUMERIC(10, 2),
    bedrooms        NUMERIC(4, 1),
    bathrooms       NUMERIC(4, 1),
    sqft            INTEGER,
    year_built      INTEGER,
    lot_sqft        NUMERIC(10, 2),
    hoa_fee         NUMERIC(10, 2),
    days_on_market  INTEGER,
    parking_garage  BOOLEAN DEFAULT FALSE,
    has_ac          BOOLEAN,
    has_pool        BOOLEAN,
    pet_friendly    BOOLEAN,
    original_price  NUMERIC(10, 2),
    price_reduced   BOOLEAN DEFAULT FALSE,
    latitude        NUMERIC(10, 7),
    longitude       NUMERIC(10, 7),
    location        GEOGRAPHY(POINT, 4326),
    source          TEXT,
    raw_data        JSONB DEFAULT '{}'::jsonb,
    property_type   TEXT,
    listing_date    DATE DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rental_geo ON rental_listings(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rental_created ON rental_listings(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_unique_listing
    ON rental_listings(address, source, listing_date);
CREATE INDEX IF NOT EXISTS idx_rental_zip ON rental_listings(zip_code);

CREATE OR REPLACE FUNCTION update_rental_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::float, NEW.latitude::float), 4326)::geography;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_rental_location ON rental_listings;
CREATE TRIGGER trg_update_rental_location
    BEFORE INSERT OR UPDATE ON rental_listings
    FOR EACH ROW
    EXECUTE FUNCTION update_rental_location();

-- =========================================================================
-- CRAWL_JOBS — scraper queue
-- =========================================================================
CREATE TABLE IF NOT EXISTS crawl_jobs (
    id              BIGSERIAL PRIMARY KEY,
    region_type     TEXT NOT NULL,
    region_value    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    error_message   TEXT,
    listings_found  INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT crawl_jobs_status_chk CHECK (status IN ('pending','processing','completed','failed'))
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_region ON crawl_jobs(region_value);

-- Recycle stuck jobs after 5 min
CREATE OR REPLACE FUNCTION recycle_stuck_jobs() RETURNS void AS $$
BEGIN
    UPDATE crawl_jobs
    SET status = 'pending', started_at = NULL
    WHERE status = 'processing' AND started_at < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- =========================================================================
-- PROFILES — user subscription state
-- =========================================================================
CREATE TABLE IF NOT EXISTS profiles (
    id                   TEXT PRIMARY KEY,
    email                TEXT,
    stripe_customer_id   TEXT,
    subscription_tier    TEXT NOT NULL DEFAULT 'free'
        CHECK (subscription_tier IN ('free', 'pro')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email)
    WHERE email IS NOT NULL;

-- =========================================================================
-- MARKET_BENCHMARKS — HUD SAFMR + market data
-- =========================================================================
CREATE TABLE IF NOT EXISTS market_benchmarks (
    zip_code        TEXT PRIMARY KEY,
    safmr_data      JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================================
-- MARKET_TARGETS — scraper schedule
-- =========================================================================
CREATE TABLE IF NOT EXISTS market_targets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location        TEXT UNIQUE NOT NULL,
    listing_type    TEXT DEFAULT 'for_sale',
    frequency_hours INTEGER DEFAULT 24,
    last_scraped    TIMESTAMPTZ,
    priority        INTEGER DEFAULT 5,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_targets_active ON market_targets(is_active) WHERE is_active = TRUE;

-- =========================================================================
-- VIEWS — operational dashboards
-- =========================================================================
CREATE OR REPLACE VIEW rental_data_stats AS
SELECT
    COUNT(*) AS total_listings,
    COUNT(DISTINCT zip_code) AS unique_zips,
    COUNT(DISTINCT city || ', ' || state) AS unique_markets,
    AVG(price) AS avg_rent,
    MIN(created_at) AS oldest_listing,
    MAX(created_at) AS newest_listing,
    SUM(CASE WHEN sqft IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 AS pct_with_sqft
FROM rental_listings;

CREATE OR REPLACE VIEW listing_geom_health AS
SELECT
    COUNT(*) AS total_listings,
    COUNT(geom) AS with_geometry,
    COUNT(*) - COUNT(geom) AS missing_geometry,
    ROUND(COUNT(geom)::numeric / NULLIF(COUNT(*), 0)::numeric * 100, 2) AS geometry_coverage_pct
FROM listings;

-- Migrate any existing data into the new generated column
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS rent_price_ratio NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN price > 0 AND estimated_rent IS NOT NULL
      THEN estimated_rent / price
      ELSE NULL
    END
  ) STORED;

-- Permissions
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres;

-- Default n8n database
CREATE DATABASE n8n;
\connect n8n
GRANT ALL ON SCHEMA public TO postgres;
