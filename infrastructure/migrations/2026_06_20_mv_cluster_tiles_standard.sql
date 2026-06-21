-- 2026_06_20_mv_cluster_tiles_standard.sql
-- The map cluster MV predates sale_type and aggregates ALL for_sale rows. Once
-- the foreclosure pass creates coexisting (standard + distress) rows at one
-- address, the default map view would double-count clusters and skew avg/min/max
-- price. Rebuild it standard-only (the canonical default view); distress views
-- use the MVT function's on-the-fly branches.
--
-- DROP + CREATE (matviews can't be CREATE OR REPLACE). CREATE populates
-- immediately; the unique index re-enables the worker's REFRESH … CONCURRENTLY.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.mv_cluster_tiles;

CREATE MATERIALIZED VIEW public.mv_cluster_tiles AS
WITH zooms AS (
    SELECT generate_series(0, 13) AS zoom
), buckets AS (
    SELECT z.zoom,
        30.0::double precision / power(2::double precision, z.zoom::double precision) AS eps,
        l.id, l.price, l.estimated_rent, l.geom
    FROM zooms z
    CROSS JOIN listings l
    WHERE l.listing_type = 'for_sale'::text
      AND l.sale_type = 'standard'::text
      AND l.geom IS NOT NULL
)
SELECT zoom,
    st_y(st_centroid(st_collect(geom))) AS latitude,
    st_x(st_centroid(st_collect(geom))) AS longitude,
    st_centroid(st_collect(geom)) AS geom,
    count(*) AS count,
    avg(price)::numeric(12,0) AS avg_price,
    min(price)::numeric(12,0) AS min_price,
    max(price)::numeric(12,0) AS max_price,
    avg(NULLIF(estimated_rent, 0::numeric))::numeric(10,0) AS avg_rent
FROM buckets
GROUP BY zoom, (st_snaptogrid(geom, eps));

CREATE UNIQUE INDEX uq_mv_cluster_tiles_zoom_xy ON public.mv_cluster_tiles USING btree (zoom, longitude, latitude);
CREATE INDEX idx_mv_cluster_tiles_zoom_geom ON public.mv_cluster_tiles USING gist (geom) INCLUDE (zoom);
CREATE INDEX idx_mv_cluster_tiles_zoom ON public.mv_cluster_tiles USING btree (zoom);

COMMIT;
