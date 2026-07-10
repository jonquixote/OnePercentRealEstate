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

CREATE OR REPLACE VIEW parcel_flood_exposure AS
SELECT
  p.county_fips,
  p.apn,
  ST_Area(ST_Intersection(p.geom, f.geom)) / NULLIF(ST_Area(p.geom), 0) AS pct_in_sfha
FROM parcels p
JOIN flood_zones f ON ST_Intersects(p.geom, f.geom)
WHERE f.sfha;
