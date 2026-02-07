-- Server-side clustering function for map performance
-- Returns proper GeoJSON FeatureCollection for Mapbox
CREATE OR REPLACE FUNCTION get_property_clusters(
        min_lat NUMERIC,
        min_lon NUMERIC,
        max_lat NUMERIC,
        max_lon NUMERIC,
        zoom_level INTEGER
    ) RETURNS JSONB AS $$
DECLARE -- Grid size in degrees (approximate)
    grid_size NUMERIC;
v_result JSONB;
BEGIN -- Dynamic grid size based on zoom level
-- Lower zoom = larger grid cells (more aggregation)
grid_size := CASE
    WHEN zoom_level <= 3 THEN 20.0
    WHEN zoom_level <= 5 THEN 5.0
    WHEN zoom_level <= 7 THEN 1.0
    WHEN zoom_level <= 9 THEN 0.25
    WHEN zoom_level <= 11 THEN 0.1
    WHEN zoom_level <= 13 THEN 0.02
    ELSE 0.005 -- High zoom: very small clusters or distinct points
END;
-- Aggregate points using simple grid snapping
-- Return proper GeoJSON Feature format for Mapbox
SELECT jsonb_agg(
        jsonb_build_object(
            'type',
            'Feature',
            'geometry',
            jsonb_build_object(
                'type',
                'Point',
                'coordinates',
                jsonb_build_array(cluster_lon, cluster_lat)
            ),
            'properties',
            jsonb_build_object(
                'id',
                cluster_id,
                'count',
                cluster_count,
                'min_price',
                min_price,
                'max_price',
                max_price,
                'avg_price',
                avg_price,
                'avg_rent',
                avg_rent
            )
        )
    ) INTO v_result
FROM (
        SELECT min(id::text) as cluster_id,
            AVG(latitude) as cluster_lat,
            AVG(longitude) as cluster_lon,
            COUNT(*) as cluster_count,
            MIN(price) as min_price,
            MAX(price) as max_price,
            ROUND(AVG(price), 0) as avg_price,
            COALESCE(
                ROUND(AVG(NULLIF(estimated_rent, 0)), 0),
                ROUND(AVG(price) * 0.008, 0)
            ) as avg_rent
        FROM listings
        WHERE latitude BETWEEN min_lat AND max_lat
            AND longitude BETWEEN min_lon AND max_lon
            AND listing_type = 'for_sale'
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
        GROUP BY ROUND(latitude / grid_size),
            ROUND(longitude / grid_size)
    ) as sub;
RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql STABLE;