-- Trigger function to automatically calculate rent estimate on insert/update
-- v2: Now passes property_type for non-rentable detection
CREATE OR REPLACE FUNCTION trigger_calculate_smart_rent()
RETURNS TRIGGER AS $$
DECLARE
    v_estimate JSONB;
BEGIN
    -- Only calculate if lat/lon are present and valid
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        -- Call calculation function with property_type
        -- Note: removed fake defaults - if bedrooms is NULL, pass NULL (let function handle it)
        v_estimate := calculate_smart_rent(
            NEW.latitude,
            NEW.longitude,
            NEW.bedrooms::int,
            NEW.bathrooms,
            NEW.sqft::int,
            NEW.zip_code,
            NEW.property_type
        );
        
        -- Extract the smart estimate (leave as NULL if calculation fails)
        NEW.estimated_rent := (v_estimate->>'active_estimate')::numeric;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists to avoid duplication errors
DROP TRIGGER IF EXISTS set_smart_rent_estimate ON listings;

-- Create the trigger (now also fires on property_type changes)
CREATE TRIGGER set_smart_rent_estimate
BEFORE INSERT OR UPDATE OF price, bedrooms, bathrooms, sqft, latitude, longitude, property_type
ON listings
FOR EACH ROW
EXECUTE FUNCTION trigger_calculate_smart_rent();

