-- infrastructure/migrations/2026_07_18_mv_cluster_tiles_lifecycle.sql
-- Rebuild the map cluster MV to be lifecycle-aware: the `buckets` CTE now
-- aggregates only ACTIVE inventory, so sold/stale/rental_misfiled rows no
-- longer pollute cluster counts or skew avg/min/max price on the map.
-- Definition is otherwise copied verbatim from 2026_06_20_mv_cluster_tiles_standard.sql.
-- DROP + recreate (a materialized view's defining query can't be ALTERed in
-- place), then recreate the unique index, REFRESH once, and hand ownership back
-- to oper_worker so the worker's REFRESH CONCURRENTLY loop keeps working.
DROP MATERIALIZED VIEW IF EXISTS mv_cluster_tiles;

-- WITH NO DATA: CREATE does not populate; the REFRESH below is the single
-- population pass (keeps migration self-contained if definition changes).
CREATE MATERIALIZED VIEW mv_cluster_tiles WITH NO DATA AS
WITH zooms AS (
    SELECT generate_series(0, 13) AS zoom
),
buckets AS (
    SELECT z.zoom,
        30.0::double precision / power(2::double precision, z.zoom::double precision) AS eps,
        l.id, l.price, l.estimated_rent, l.geom
    FROM zooms z
    CROSS JOIN listings l
    WHERE l.listing_type = 'for_sale'::text
      AND l.sale_type = 'standard'::text
      AND l.geom IS NOT NULL
      AND l.listing_status = 'active'::text
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

-- Single population pass (CREATE used WITH NO DATA above).
REFRESH MATERIALIZED VIEW mv_cluster_tiles;

-- The worker refresh loop connects as oper_worker (see worker-refresh service /
-- refresh-clusters.ts). REFRESH MATERIALIZED VIEW CONCURRENTLY requires ownership,
-- so hand it over. Wrapped in a DO block: the role exists on prod (created by the
-- out-of-band db_roles migration) but NOT in CI/local dry-runs, where a bare
-- ALTER would fail the migration runner (role "oper_worker" does not exist).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'oper_worker') THEN
    ALTER MATERIALIZED VIEW mv_cluster_tiles OWNER TO oper_worker;
  END IF;
END
$$;
