CREATE TABLE IF NOT EXISTS sold_listings (
  id             BIGSERIAL PRIMARY KEY,
  address        TEXT NOT NULL,
  city           TEXT,
  state          TEXT,
  zip_code       TEXT,
  sold_price     NUMERIC,
  sold_date      DATE,
  list_price     NUMERIC,
  bedrooms       NUMERIC(4,1),
  bathrooms      NUMERIC(4,1),
  sqft           INTEGER,
  year_built     INTEGER,
  lot_sqft       NUMERIC,
  property_type  TEXT,
  latitude       NUMERIC(10,7),
  longitude      NUMERIC(10,7),
  geom           geometry(Point, 4326),
  source         TEXT NOT NULL DEFAULT 'homeharvest',
  raw_data       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sold_unique ON sold_listings (address, sold_date);
CREATE INDEX IF NOT EXISTS idx_sold_geo ON sold_listings USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_sold_zip ON sold_listings (zip_code, sold_date DESC);

CREATE OR REPLACE FUNCTION update_sold_listings_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude::float, NEW.latitude::float), 4326);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_sold_listings_geom ON sold_listings;
CREATE TRIGGER trg_update_sold_listings_geom
    BEFORE INSERT OR UPDATE ON sold_listings
    FOR EACH ROW
    EXECUTE FUNCTION update_sold_listings_geom();
