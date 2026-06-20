-- Migration: Fix mv_cluster_tiles unique index to support CONCURRENT refresh
-- The previous index uq_mv_cluster_tiles_zoom_xy used expressions: (zoom, ST_X(geom), ST_Y(geom))
-- PostgreSQL does not allow REFRESH MATERIALIZED VIEW CONCURRENTLY if the unique index contains expressions.
-- It must contain only simple column names. Since longitude and latitude are already computed columns
-- in mv_cluster_tiles, we can index (zoom, longitude, latitude) directly.

DROP INDEX IF EXISTS uq_mv_cluster_tiles_zoom_xy;

CREATE UNIQUE INDEX uq_mv_cluster_tiles_zoom_xy
  ON mv_cluster_tiles (zoom, longitude, latitude);
