-- 2026_06_22_observability_views.sql
-- Lightweight observability for the rules engine. Read-only views for an
-- admin/debug surface: coverage, sale-type distribution, fallback-tier usage,
-- buy-hold pass rates, and the active rule matrix (incl. provisional flags).
-- resolve_rule() is evaluated per distinct (type, sale_type) combo, not per row.

BEGIN;

-- How many listings are missing key underwriting inputs.
CREATE OR REPLACE VIEW public.v_underwriting_coverage AS
SELECT
    count(*)                                                              AS total,
    count(*) FILTER (WHERE estimated_rent IS NULL OR estimated_rent = 0)  AS missing_rent,
    count(*) FILTER (WHERE price IS NULL OR price = 0)                    AS missing_price,
    count(*) FILTER (WHERE sqft IS NULL OR sqft = 0)                      AS missing_sqft,
    count(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)         AS missing_geo,
    count(*) FILTER (WHERE rent_calc_status = 'pending')                  AS rent_pending
FROM public.listings
WHERE listing_type = 'for_sale';

-- Distribution of sale types and how each was classified.
CREATE OR REPLACE VIEW public.v_sale_type_distribution AS
SELECT sale_type, sale_type_source, count(*) AS listings
FROM public.listings
GROUP BY sale_type, sale_type_source
ORDER BY listings DESC;

-- Which resolve_rule() fallback tier each (type, sale_type, strategy) combo lands
-- on, weighted by how many listings share that (type, sale_type).
CREATE OR REPLACE VIEW public.v_rule_fallback_usage AS
SELECT c.property_type, c.sale_type, st.strategy, rr.resolved_tier, c.listings
FROM (
    SELECT property_type, sale_type, count(*) AS listings
    FROM public.listings
    GROUP BY property_type, sale_type
) c
CROSS JOIN (VALUES ('buy_hold'),('brrrr'),('flip'),('str')) AS st(strategy)
LEFT JOIN LATERAL public.resolve_rule(c.property_type, c.sale_type, st.strategy) rr ON TRUE;

-- Buy-and-hold 1%-rule pass rate by property type and sale type.
CREATE OR REPLACE VIEW public.v_buy_hold_pass_rates AS
WITH rows AS (
    SELECT property_type, sale_type, estimated_rent, price
    FROM public.listings
    WHERE listing_type = 'for_sale'
), thresholds AS (
    SELECT c.property_type, c.sale_type, rr.target_ratio
    FROM (SELECT DISTINCT property_type, sale_type FROM rows) c
    LEFT JOIN LATERAL public.resolve_rule(c.property_type, c.sale_type, 'buy_hold') rr ON TRUE
)
SELECT r.property_type, r.sale_type,
       count(*) AS total,
       count(*) FILTER (
           WHERE r.estimated_rent IS NOT NULL AND r.price > 0
             AND (r.estimated_rent / NULLIF(r.price, 0)) >= t.target_ratio
       ) AS clears_target_ratio
FROM rows r
JOIN thresholds t USING (property_type, sale_type)
GROUP BY r.property_type, r.sale_type
ORDER BY clears_target_ratio DESC;

-- Active rule matrix, including how many rules are provisional.
CREATE OR REPLACE VIEW public.v_underwriting_rules_active AS
SELECT strategy, property_type, sale_type, is_provisional, rule_version, rule_set_version,
       target_ratio, target_cap_rate, target_coc, min_dscr, arv_discount, refi_ltv
FROM public.underwriting_rules
WHERE is_active AND effective_to IS NULL
ORDER BY strategy, property_type, sale_type;

COMMIT;
