-- 2026_06_03_mv_cluster_tiles.sql
-- Wave 2: pre-compute clusters for zoom levels 0–13 so viewport queries
-- on cache miss don't redo ST_Centroid(ST_Collect(...)) every time.
--
-- One MV with a `zoom` column + composite index is simpler than 14
-- separate MVs and the row counts are small enough to not matter.
--
-- Refresh strategy: REFRESH MATERIALIZED VIEW CONCURRENTLY every 10 min
-- from the worker. CONCURRENTLY requires a UNIQUE index, which we add
-- on (zoom, lon, lat).
--
-- The viewport route only uses this MV when no user filters are active
-- (price/beds/baths). Filtered clusters fall back to the on-the-fly
-- path because pre-baking every filter combination would explode the
-- row count.

DROP MATERIALIZED VIEW IF EXISTS mv_cluster_tiles;

CREATE MATERIALIZED VIEW mv_cluster_tiles AS
WITH zooms AS (
  SELECT generate_series(0, 13) AS zoom
),
buckets AS (
  SELECT
    z.zoom,
    -- eps mirrors the live route's grid math: 30 / 2^zoom.
    30.0 / power(2, z.zoom) AS eps,
    l.id,
    l.price,
    l.estimated_rent,
    l.geom
  FROM zooms z
  CROSS JOIN listings l
  WHERE l.listing_type = 'for_sale'
    AND l.geom IS NOT NULL
)
SELECT
  zoom,
  ST_Y(ST_Centroid(ST_Collect(geom)))::double precision AS latitude,
  ST_X(ST_Centroid(ST_Collect(geom)))::double precision AS longitude,
  ST_Centroid(ST_Collect(geom)) AS geom,
  COUNT(*)::bigint AS count,
  AVG(price)::numeric(12,0) AS avg_price,
  MIN(price)::numeric(12,0) AS min_price,
  MAX(price)::numeric(12,0) AS max_price,
  AVG(NULLIF(estimated_rent, 0))::numeric(10,0) AS avg_rent
FROM buckets
GROUP BY zoom, ST_SnapToGrid(geom, eps);

-- UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- (zoom, ST_X(geom), ST_Y(geom)) is unique by construction: each row is
-- exactly one snap-grid cell per zoom level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_cluster_tiles_zoom_xy
  ON mv_cluster_tiles (zoom, ST_X(geom), ST_Y(geom));

-- Spatial index for envelope intersection (geom && ST_MakeEnvelope(...)).
CREATE INDEX IF NOT EXISTS idx_mv_cluster_tiles_zoom_geom
  ON mv_cluster_tiles USING GIST (geom)
  INCLUDE (zoom);

-- Helper: lookup by zoom (B-tree). The composite GIST already covers
-- zoom-filtered envelope queries via the INCLUDE, but a plain B-tree
-- on zoom keeps point-lookups cheap too.
CREATE INDEX IF NOT EXISTS idx_mv_cluster_tiles_zoom
  ON mv_cluster_tiles (zoom);

-- Seed the MV (no-op if empty). The worker's refresh loop takes over
-- after the first 10-min tick.
REFRESH MATERIALIZED VIEW mv_cluster_tiles;
