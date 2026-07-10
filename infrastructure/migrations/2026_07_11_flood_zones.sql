CREATE TABLE IF NOT EXISTS flood_zones (
  id BIGSERIAL PRIMARY KEY,
  state_fips TEXT NOT NULL,
  fld_zone TEXT NOT NULL,
  sfha BOOLEAN NOT NULL,
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flood_zones_geom ON flood_zones USING GIST (geom);

CREATE OR REPLACE FUNCTION flood_zone_at(lat float, lng float)
RETURNS TABLE(fld_zone text, sfha boolean) AS $$
  SELECT fld_zone, sfha FROM flood_zones
  WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
  ORDER BY sfha DESC
  LIMIT 1
$$ LANGUAGE sql STABLE;
