-- Smart Rent Estimation Function
-- Uses PostGIS for spatial queries and weighted similarity scoring
-- Returns estimate with confidence score and comparable rentals

-- Haversine distance function (if PostGIS not available)
CREATE OR REPLACE FUNCTION haversine_miles(
    lat1 NUMERIC, lon1 NUMERIC,
    lat2 NUMERIC, lon2 NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    R CONSTANT NUMERIC := 3958.8; -- Earth radius in miles
    dlat NUMERIC;
    dlon NUMERIC;
    a NUMERIC;
    c NUMERIC;
BEGIN
    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);
    a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)^2;
    c := 2 * atan2(sqrt(a), sqrt(1-a));
    RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- Main Smart Rent Estimation Function
-- v2: Added property_type awareness for non-rentable properties (land, lots, vacant)
CREATE OR REPLACE FUNCTION calculate_smart_rent(
    p_lat NUMERIC,
    p_lon NUMERIC,
    p_beds INT,
    p_baths NUMERIC DEFAULT NULL,
    p_sqft INT DEFAULT NULL,
    p_zip_code TEXT DEFAULT NULL,
    p_property_type TEXT DEFAULT NULL,
    p_radius_miles NUMERIC DEFAULT 2.0,
    p_max_comps INT DEFAULT 15
) RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_safmr_rent NUMERIC;
    v_comps_avg NUMERIC;
    v_smart_estimate NUMERIC;
    v_confidence NUMERIC;
    v_comp_count INT;
    v_comps JSONB;
    v_non_rentable_types TEXT[] := ARRAY[
        'LAND', 'LOT', 'LOTS', 'VACANT', 'VACANT_LAND', 'LOTS/LAND', 
        'FARM', 'MOBILE_LAND', 'OTHER', 'TIMBERLAND', 'AGRICULTURAL'
    ];
    v_property_type_upper TEXT;
BEGIN
    -- 0. Check if property type is non-rentable (land, vacant, etc.)
    IF p_property_type IS NOT NULL THEN
        v_property_type_upper := UPPER(TRIM(p_property_type));
        -- Check for exact match or partial match containing 'LAND' or 'LOT'
        IF v_property_type_upper = ANY(v_non_rentable_types) 
           OR v_property_type_upper LIKE '%LAND%' 
           OR v_property_type_upper LIKE '%LOT%'
           OR v_property_type_upper LIKE '%VACANT%' THEN
            RETURN jsonb_build_object(
                'hud_fmr', NULL,
                'comps_avg', NULL,
                'smart_estimate', 0,
                'active_estimate', 0,
                'confidence_score', 1.0,
                'comp_count', 0,
                'method', 'non_rentable_property_type',
                'property_type', p_property_type,
                'reason', 'Property type indicates no rentable structure',
                'comps', '[]'::jsonb
            );
        END IF;
    END IF;

    -- 1. Get HUD SAFMR benchmark if zip available
    IF p_zip_code IS NOT NULL THEN
        SELECT (safmr_data->>CONCAT(p_beds::text, 'br'))::numeric
        INTO v_safmr_rent
        FROM market_benchmarks
        WHERE zip_code = p_zip_code;
    END IF;

    -- 2. Find comparable rentals with weighted scoring
    WITH scored_comps AS (
        SELECT 
            id,
            address,
            price,
            bedrooms,
            bathrooms,
            sqft,
            -- Distance calculation (use PostGIS if available, else Haversine)
            CASE 
                WHEN location IS NOT NULL THEN 
                    ST_Distance(location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) / 1609.34
                ELSE 
                    haversine_miles(p_lat, p_lon, latitude, longitude)
            END as distance_miles,
            days_on_market,
            created_at
        FROM rental_listings
        WHERE 
            latitude IS NOT NULL 
            AND longitude IS NOT NULL
            AND price > 0
            AND bedrooms BETWEEN COALESCE(p_beds - 1, 0) AND COALESCE(p_beds + 1, 10)
            -- Only recent listings (within 90 days)
            AND created_at > NOW() - INTERVAL '90 days'
    ),
    filtered_comps AS (
        SELECT *,
            -- Calculate similarity score (0-1)
            (
                -- Distance weight (closer = better, max 0.4)
                GREATEST(0, 0.4 * (1 - distance_miles / p_radius_miles))
                -- Bedroom match (exact = 0.25, ±1 = 0.15)
                + CASE WHEN bedrooms = p_beds THEN 0.25 
                       ELSE 0.15 END
                -- Bathroom match (within 0.5 = 0.1)
                + CASE WHEN p_baths IS NULL THEN 0.05
                       WHEN ABS(COALESCE(bathrooms, p_baths) - p_baths) <= 0.5 THEN 0.1
                       ELSE 0.03 END
                -- Sqft match (within 20% = 0.15)
                + CASE WHEN p_sqft IS NULL OR sqft IS NULL OR sqft = 0 OR p_sqft = 0 THEN 0.05
                       WHEN ABS(sqft - p_sqft) / NULLIF(GREATEST(sqft, p_sqft), 0) <= 0.2 THEN 0.15
                       WHEN ABS(sqft - p_sqft) / NULLIF(GREATEST(sqft, p_sqft), 0) <= 0.4 THEN 0.08
                       ELSE 0.02 END
                -- Recency bonus (last 30 days = 0.1)
                + CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 0.1
                       WHEN created_at > NOW() - INTERVAL '60 days' THEN 0.05
                       ELSE 0.0 END
            ) as similarity_score
        FROM scored_comps
        WHERE distance_miles <= p_radius_miles
    ),
    top_comps AS (
        SELECT * FROM filtered_comps
        ORDER BY similarity_score DESC
        LIMIT p_max_comps
    )
    SELECT 
        COUNT(*)::INT,
        ROUND(AVG(price)::numeric, 0),
        -- Weighted average based on similarity score
        ROUND((SUM(price * similarity_score) / NULLIF(SUM(similarity_score), 0))::numeric, 0),
        -- Confidence: based on comp count and average similarity
        LEAST(1.0, (COUNT(*) / 5.0) * (AVG(similarity_score) / 0.6))::numeric,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'address', address,
                    'price', price,
                    'beds', bedrooms,
                    'baths', bathrooms,
                    'sqft', sqft,
                    'distance', ROUND(distance_miles::numeric, 2),
                    'score', ROUND(similarity_score::numeric, 2)
                ) ORDER BY similarity_score DESC
            ) FILTER (WHERE price IS NOT NULL),
            '[]'::jsonb
        )
    INTO v_comp_count, v_comps_avg, v_smart_estimate, v_confidence, v_comps
    FROM top_comps;

    -- 3. Calculate national average fallback based on bedrooms
    -- Based on 2024 US national rental averages
    DECLARE
        v_national_fallback NUMERIC;
        v_final_estimate NUMERIC;
        v_method TEXT;
    BEGIN
        v_national_fallback := CASE COALESCE(p_beds, 2)
            WHEN 0 THEN 1100  -- Studio
            WHEN 1 THEN 1300  -- 1BR
            WHEN 2 THEN 1550  -- 2BR
            WHEN 3 THEN 1950  -- 3BR
            WHEN 4 THEN 2350  -- 4BR
            WHEN 5 THEN 2750  -- 5BR
            ELSE 2000 + (COALESCE(p_beds, 3) - 3) * 400  -- 6BR+
        END;
        
        -- Determine final estimate with fallback chain
        IF v_comp_count >= 3 THEN
            v_final_estimate := v_smart_estimate;
            v_method := 'smart_weighted';
        ELSIF v_comp_count >= 1 THEN
            v_final_estimate := v_comps_avg;
            v_method := 'comps_average';
        ELSIF v_safmr_rent IS NOT NULL THEN
            v_final_estimate := v_safmr_rent;
            v_method := 'hud_fmr';
        ELSE
            v_final_estimate := v_national_fallback;
            v_method := 'national_average_fallback';
            v_confidence := 0.25;  -- Low confidence for fallback
        END IF;

        -- 4. Build final result
        v_result := jsonb_build_object(
            'hud_fmr', v_safmr_rent,
            'comps_avg', v_comps_avg,
            'smart_estimate', COALESCE(v_smart_estimate, v_comps_avg, v_safmr_rent, v_national_fallback),
            'active_estimate', v_final_estimate,
            'national_fallback', v_national_fallback,
            'confidence_score', ROUND(COALESCE(v_confidence, 0.25)::numeric, 2),
            'comp_count', COALESCE(v_comp_count, 0),
            'method', v_method,
            'comps', COALESCE(v_comps, '[]'::jsonb)
        );

        RETURN v_result;
    END;
END;
$$ LANGUAGE plpgsql STABLE;


-- Convenience function for quick estimates
CREATE OR REPLACE FUNCTION quick_rent_estimate(
    p_address TEXT
) RETURNS JSONB AS $$
DECLARE
    v_property RECORD;
BEGIN
    -- Look up property details from listings table
    SELECT latitude, longitude, bedrooms, bathrooms, sqft, 
           (raw_data->>'zip_code')::text as zip_code,
           property_type
    INTO v_property
    FROM listings
    WHERE address ILIKE '%' || p_address || '%'
    LIMIT 1;

    IF v_property IS NULL THEN
        RETURN jsonb_build_object('error', 'Property not found');
    END IF;

    RETURN calculate_smart_rent(
        v_property.latitude,
        v_property.longitude,
        v_property.bedrooms::int,
        v_property.bathrooms,
        v_property.sqft::int,
        v_property.zip_code,
        v_property.property_type
    );
END;
$$ LANGUAGE plpgsql STABLE;



-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_smart_rent TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_smart_rent TO anon;
GRANT EXECUTE ON FUNCTION quick_rent_estimate TO authenticated;
