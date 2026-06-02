-- Server-side clustering function for map performance.
-- Returns proper GeoJSON FeatureCollection for Mapbox.
-- Grid size scales with zoom level (lower zoom = larger clusters).
CREATE OR REPLACE FUNCTION get_property_clusters(
        min_lat NUMERIC,
        min_lon NUMERIC,
        max_lat NUMERIC,
        max_lon NUMERIC,
        zoom_level INTEGER
    ) RETURNS JSONB AS $$
DECLARE
    grid_size NUMERIC;
    v_result JSONB;
BEGIN
    grid_size := CASE
        WHEN zoom_level <= 3 THEN 20.0
        WHEN zoom_level <= 5 THEN 5.0
        WHEN zoom_level <= 7 THEN 1.0
        WHEN zoom_level <= 9 THEN 0.25
        WHEN zoom_level <= 11 THEN 0.1
        WHEN zoom_level <= 13 THEN 0.02
        ELSE 0.005
    END;

    SELECT jsonb_agg(
        jsonb_build_object(
            'type', 'Feature',
            'geometry', jsonb_build_object(
                'type', 'Point',
                'coordinates', jsonb_build_array(cluster_lon, cluster_lat)
            ),
            'properties', jsonb_build_object(
                'id', cluster_id,
                'count', cluster_count,
                'min_price', min_price,
                'max_price', max_price,
                'avg_price', avg_price,
                'avg_rent', avg_rent
            )
        )
    ) INTO v_result
    FROM (
        SELECT
            MIN(id::text) AS cluster_id,
            AVG(latitude) AS cluster_lat,
            AVG(longitude) AS cluster_lon,
            COUNT(*) AS cluster_count,
            MIN(price) AS min_price,
            MAX(price) AS max_price,
            ROUND(AVG(price), 0) AS avg_price,
            COALESCE(
                ROUND(AVG(NULLIF(estimated_rent, 0)), 0),
                ROUND(AVG(price) * 0.008, 0)
            ) AS avg_rent
        FROM listings
        WHERE latitude BETWEEN min_lat AND max_lat
            AND longitude BETWEEN min_lon AND max_lon
            AND listing_type = 'for_sale'
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
        GROUP BY ROUND(latitude / grid_size), ROUND(longitude / grid_size)
    ) sub;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE;


GRANT EXECUTE ON FUNCTION get_property_clusters TO PUBLIC;
