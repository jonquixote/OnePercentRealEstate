-- Map overlay sources for pg_tileserv (frontend-map-overhaul B1/B2).
--
-- h3_geoms: polygon geometry per H3 res-8 hex referenced by h3_market_stats.
-- Populated by market_stats.py (python-side h3, no PG extension): full
-- backfill via `--backfill-geoms`, then incrementally for new hexes on the
-- nightly refresh.
CREATE TABLE IF NOT EXISTS h3_geoms (
  h3_8 TEXT PRIMARY KEY,
  geom GEOMETRY(Polygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_h3_geoms_geom ON h3_geoms USING GIST (geom);

-- rent_heat: latest month's median rent $/sqft per hex, with geometry.
-- pg_tileserv serves views with a geom column like tables.
CREATE OR REPLACE VIEW rent_heat AS
SELECT g.h3_8, g.geom, s.med_rent_psf, s.n_rent
FROM h3_geoms g
JOIN LATERAL (
  SELECT med_rent_psf, n_rent FROM h3_market_stats m
  WHERE m.h3_8 = g.h3_8 AND m.med_rent_psf IS NOT NULL
  ORDER BY stat_month DESC LIMIT 1
) s ON true;

-- tract_context: census tract polygons + latest demographics + NRI risk,
-- for the tract choropleth (income / rent / risk paint modes).
CREATE OR REPLACE VIEW tract_context AS
SELECT c.geoid, c.geom,
       c.nri_overall_score,
       t.median_hh_income, t.median_gross_rent
FROM census_tracts c
LEFT JOIN LATERAL (
  SELECT median_hh_income, median_gross_rent FROM tract_demographics d
  WHERE d.geoid = c.geoid ORDER BY acs_year DESC LIMIT 1
) t ON true;
