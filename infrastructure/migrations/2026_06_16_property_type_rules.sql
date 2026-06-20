-- 2026_06_16_property_type_rules.sql
-- Create property_type_rules table and seed values.
-- Used to unify rentable/non-rentable properties and financial ratios.

BEGIN;

CREATE TABLE IF NOT EXISTS public.property_type_rules (
    property_type VARCHAR(100) PRIMARY KEY,
    is_rentable BOOLEAN NOT NULL DEFAULT TRUE,
    target_ratio NUMERIC(4,3) NOT NULL DEFAULT 0.010, -- target rent/price ratio (e.g. 0.010 = 1%)
    vacancy_rate NUMERIC(4,3) NOT NULL DEFAULT 0.050, -- vacancy expense rate (5%)
    maintenance_rate NUMERIC(4,3) NOT NULL DEFAULT 0.050, -- maintenance expense rate (5%)
    management_rate NUMERIC(4,3) NOT NULL DEFAULT 0.080, -- property management fee (8%)
    capex_rate NUMERIC(4,3) NOT NULL DEFAULT 0.050, -- capital expenditures reserve (5%)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Seed property type rules
INSERT INTO public.property_type_rules (property_type, is_rentable, target_ratio, vacancy_rate, maintenance_rate, management_rate, capex_rate)
VALUES
    ('SINGLE_FAMILY', TRUE, 0.010, 0.050, 0.050, 0.080, 0.050),
    ('CONDOS', TRUE, 0.008, 0.040, 0.030, 0.080, 0.030),
    ('TOWNHOMES', TRUE, 0.009, 0.040, 0.040, 0.080, 0.040),
    ('MULTI_FAMILY', TRUE, 0.012, 0.070, 0.070, 0.090, 0.060),
    ('MOBILE', TRUE, 0.012, 0.080, 0.080, 0.100, 0.080),
    ('COOP', TRUE, 0.007, 0.040, 0.030, 0.080, 0.030),
    ('CONDO_TOWNHOME_ROWHOME_COOP', TRUE, 0.008, 0.040, 0.035, 0.080, 0.035),
    ('DUPLEX_TRIPLEX', TRUE, 0.011, 0.060, 0.060, 0.090, 0.050),
    ('APARTMENT', TRUE, 0.011, 0.060, 0.060, 0.090, 0.050),
    ('CONDOP', TRUE, 0.008, 0.040, 0.030, 0.080, 0.030),
    -- Non-rentable property types
    ('LAND', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('LOT', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('LOTS', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('VACANT', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('VACANT_LAND', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('LOTS/LAND', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('FARM', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('MOBILE_LAND', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('OTHER', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('TIMBERLAND', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000),
    ('AGRICULTURAL', FALSE, 0.000, 0.000, 0.000, 0.000, 0.000)
ON CONFLICT (property_type) DO UPDATE
SET is_rentable = EXCLUDED.is_rentable,
    target_ratio = EXCLUDED.target_ratio,
    vacancy_rate = EXCLUDED.vacancy_rate,
    maintenance_rate = EXCLUDED.maintenance_rate,
    management_rate = EXCLUDED.management_rate,
    capex_rate = EXCLUDED.capex_rate,
    updated_at = NOW();

-- Create helper function to check rentability
CREATE OR REPLACE FUNCTION public.is_rentable(p_type TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_rentable BOOLEAN;
BEGIN
    -- Exclude if matches known non-rentable substrings
    IF p_type IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Substring checks for fallback/new types (matches logic in legacy Python estimator)
    IF UPPER(p_type) LIKE '%LAND%' OR UPPER(p_type) LIKE '%LOT%' OR UPPER(p_type) LIKE '%VACANT%' OR UPPER(p_type) LIKE '%FARM%' OR UPPER(p_type) LIKE '%AGRICULTURAL%' THEN
        RETURN FALSE;
    END IF;

    SELECT is_rentable INTO v_rentable
    FROM public.property_type_rules
    WHERE UPPER(property_type) = UPPER(p_type);
    
    IF FOUND THEN
        RETURN v_rentable;
    ELSE
        -- Default to true for unknown types that pass the substring filter
        RETURN TRUE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;
