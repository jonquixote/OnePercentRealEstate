CREATE TABLE IF NOT EXISTS census_tracts (
  geoid       TEXT PRIMARY KEY,
  state_fips  TEXT NOT NULL,
  geom        geometry(MultiPolygon, 4326) NOT NULL,
  nri_flood_riverine_score NUMERIC,
  nri_flood_coastal_score  NUMERIC,
  nri_overall_score        NUMERIC,
  nri_overall_rating       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracts_geom ON census_tracts USING gist (geom);

ALTER TABLE listings ADD COLUMN IF NOT EXISTS census_tract TEXT;
