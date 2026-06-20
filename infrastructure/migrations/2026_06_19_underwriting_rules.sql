-- 2026_06_19_underwriting_rules.sql
-- The strategy / sale-type / threshold / financing layer of the rules engine.
--
-- Two-table model:
--   property_type_rules  = asset & operating profile (rentability + opex rates)  [existing]
--   underwriting_rules   = strategy thresholds + financing assumptions           [this file]
--
-- Grain: (property_type, sale_type, strategy). Lifecycle-aware (effective_from/to,
-- is_active) so rule evolution is auditable. resolve_rule() returns ONE self-complete
-- row plus the fallback TIER that won, so every evaluation is explainable.
--
-- All ratio/rate columns are FRACTIONS (0.0100 = 1%) to match packages/primitives
-- underwriting.ts (the canonical math). GRM / price-to-rent use ANNUAL rent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.underwriting_rules (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_type        VARCHAR(100) NOT NULL DEFAULT 'DEFAULT',
    sale_type            TEXT         NOT NULL DEFAULT 'standard',
    strategy             TEXT         NOT NULL,

    -- buy-and-hold thresholds
    target_ratio         NUMERIC(6,4),   -- monthly rent / price  (1%/2% rule)
    min_gross_yield      NUMERIC(6,4),   -- annual rent / price   (floor)
    target_grm           NUMERIC(7,2),   -- price / annual rent   (ceiling)
    target_cap_rate      NUMERIC(6,4),   -- NOI / price           (floor)
    target_coc           NUMERIC(6,4),   -- cash-on-cash          (floor)
    min_dscr             NUMERIC(6,3),   -- NOI / annual debt svc  (floor)
    min_debt_yield       NUMERIC(6,4),   -- NOI / loan amount      (floor)
    max_price_to_rent    NUMERIC(7,2),   -- price / annual rent    (ceiling)
    fifty_pct_opex_ratio NUMERIC(5,3) DEFAULT 0.500,  -- 50% rule opex assumption

    -- flip / BRRRR
    arv_discount         NUMERIC(5,3),   -- 70% rule: MAO = arv*arv_discount - rehab
    rehab_per_sqft       NUMERIC(8,2),   -- rehab assumption when no quote
    min_flip_roi         NUMERIC(6,4),   -- projected profit / cash-in (floor)
    refi_ltv             NUMERIC(5,3),   -- BRRRR cash-out refi LTV

    -- STR (seam + placeholder; flagged provisional until a revenue signal exists)
    str_adr              NUMERIC(8,2),
    str_occupancy        NUMERIC(5,3),
    str_target_cap_rate  NUMERIC(6,4),

    -- financing assumptions — single source of truth (replaces calculators.ts hardcodes)
    down_payment_pct     NUMERIC(5,3)  DEFAULT 0.200,
    interest_rate        NUMERIC(6,4)  DEFAULT 0.0650,
    loan_term_years      INT           DEFAULT 30,
    closing_cost_pct     NUMERIC(5,3)  DEFAULT 0.030,
    property_tax_rate    NUMERIC(6,4)  DEFAULT 0.0120,
    insurance_annual     NUMERIC(10,2) DEFAULT 1200,

    -- lifecycle / provenance
    effective_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to         TIMESTAMPTZ NULL,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    is_provisional       BOOLEAN NOT NULL DEFAULT FALSE,
    rule_version         TEXT NULL,
    rule_set_version     INTEGER NULL,
    created_by           TEXT NULL,
    explanation          TEXT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT underwriting_rules_strategy_chk
        CHECK (strategy IN ('buy_hold','brrrr','flip','str')),
    CONSTRAINT underwriting_rules_saletype_chk
        CHECK (sale_type IN ('standard','foreclosure','pre_foreclosure','reo','auction','short_sale'))
);

-- Exactly one ACTIVE, current row per logical key. History rows keep is_active=false
-- or a non-null effective_to, so they don't collide here.
CREATE UNIQUE INDEX IF NOT EXISTS underwriting_rules_active_key
    ON public.underwriting_rules (property_type, sale_type, strategy)
    WHERE is_active AND effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- Seeds (rule_set_version 1). Every row is self-complete so single-row
-- resolution stays explainable. The fallback chain in resolve_rule() covers
-- contexts that aren't seeded explicitly.
-- ---------------------------------------------------------------------------

-- buy-and-hold baseline
INSERT INTO public.underwriting_rules
    (property_type, sale_type, strategy, target_ratio, min_gross_yield, target_grm,
     target_cap_rate, target_coc, min_dscr, min_debt_yield, max_price_to_rent,
     fifty_pct_opex_ratio, down_payment_pct, interest_rate, loan_term_years,
     closing_cost_pct, property_tax_rate, insurance_annual,
     rule_version, rule_set_version, created_by, explanation)
VALUES
    ('DEFAULT','standard','buy_hold', 0.0100, 0.1200, 8.33, 0.0600, 0.0800, 1.200, 0.0900, 8.33,
     0.500, 0.200, 0.0650, 30, 0.030, 0.0120, 1200,
     'v1', 1, 'migration:2026_06_19', 'Baseline buy-and-hold underwriting (1% rule foundation).')
ON CONFLICT (property_type, sale_type, strategy) WHERE is_active AND effective_to IS NULL
DO UPDATE SET target_ratio = EXCLUDED.target_ratio, min_gross_yield = EXCLUDED.min_gross_yield,
    target_grm = EXCLUDED.target_grm, target_cap_rate = EXCLUDED.target_cap_rate,
    target_coc = EXCLUDED.target_coc, min_dscr = EXCLUDED.min_dscr,
    min_debt_yield = EXCLUDED.min_debt_yield, max_price_to_rent = EXCLUDED.max_price_to_rent,
    updated_at = now();

-- buy-and-hold per rentable property type — target_ratio synced from property_type_rules,
-- derived gross-yield / GRM / price-to-rent, other thresholds inherited from baseline so
-- each row is self-complete.
INSERT INTO public.underwriting_rules
    (property_type, sale_type, strategy, target_ratio, min_gross_yield, target_grm,
     target_cap_rate, target_coc, min_dscr, min_debt_yield, max_price_to_rent,
     fifty_pct_opex_ratio, down_payment_pct, interest_rate, loan_term_years,
     closing_cost_pct, property_tax_rate, insurance_annual,
     rule_version, rule_set_version, created_by, explanation)
SELECT ptr.property_type, 'standard', 'buy_hold',
    ptr.target_ratio,
    ROUND(ptr.target_ratio * 12, 4),
    ROUND(1.0 / NULLIF(ptr.target_ratio * 12, 0), 2),
    0.0600, 0.0800, 1.200, 0.0900,
    ROUND(1.0 / NULLIF(ptr.target_ratio * 12, 0), 2),
    0.500, 0.200, 0.0650, 30, 0.030, 0.0120, 1200,
    'v1', 1, 'migration:2026_06_19',
    'Per-type buy-and-hold; target_ratio synced from property_type_rules.'
FROM public.property_type_rules ptr
WHERE ptr.is_rentable = TRUE
ON CONFLICT (property_type, sale_type, strategy) WHERE is_active AND effective_to IS NULL
DO UPDATE SET target_ratio = EXCLUDED.target_ratio, min_gross_yield = EXCLUDED.min_gross_yield,
    target_grm = EXCLUDED.target_grm, max_price_to_rent = EXCLUDED.max_price_to_rent,
    updated_at = now();

-- fix-and-flip (70% rule) — baseline + distress variants (tighter ARV, higher rehab/ROI).
INSERT INTO public.underwriting_rules
    (property_type, sale_type, strategy, arv_discount, rehab_per_sqft, min_flip_roi,
     down_payment_pct, interest_rate, loan_term_years, closing_cost_pct,
     rule_version, rule_set_version, created_by, explanation)
VALUES
    ('DEFAULT','standard',       'flip', 0.700, 35.00, 0.1500, 0.200, 0.0650, 30, 0.030,
     'v1', 1, 'migration:2026_06_19', '70% rule baseline flip.'),
    ('DEFAULT','auction',        'flip', 0.650, 45.00, 0.2000, 0.200, 0.0650, 30, 0.030,
     'v1', 1, 'migration:2026_06_19', 'Auction flip — tighter ARV + higher rehab contingency.'),
    ('DEFAULT','foreclosure',    'flip', 0.680, 45.00, 0.1800, 0.200, 0.0650, 30, 0.030,
     'v1', 1, 'migration:2026_06_19', 'Foreclosure flip.'),
    ('DEFAULT','pre_foreclosure','flip', 0.680, 45.00, 0.1800, 0.200, 0.0650, 30, 0.030,
     'v1', 1, 'migration:2026_06_19', 'Pre-foreclosure flip.'),
    ('DEFAULT','reo',            'flip', 0.680, 40.00, 0.1800, 0.200, 0.0650, 30, 0.030,
     'v1', 1, 'migration:2026_06_19', 'REO flip.'),
    ('DEFAULT','short_sale',     'flip', 0.700, 40.00, 0.1600, 0.200, 0.0650, 30, 0.030,
     'v1', 1, 'migration:2026_06_19', 'Short-sale flip.')
ON CONFLICT (property_type, sale_type, strategy) WHERE is_active AND effective_to IS NULL
DO UPDATE SET arv_discount = EXCLUDED.arv_discount, rehab_per_sqft = EXCLUDED.rehab_per_sqft,
    min_flip_roi = EXCLUDED.min_flip_roi, updated_at = now();

-- BRRRR — 75% rule via refi LTV + buy-hold targets on the held asset.
INSERT INTO public.underwriting_rules
    (property_type, sale_type, strategy, target_ratio, target_cap_rate, arv_discount,
     rehab_per_sqft, refi_ltv, min_dscr, down_payment_pct, interest_rate, loan_term_years,
     closing_cost_pct, property_tax_rate, insurance_annual,
     rule_version, rule_set_version, created_by, explanation)
VALUES
    ('DEFAULT','standard',   'brrrr', 0.0100, 0.0700, 0.750, 35.00, 0.750, 1.200, 0.200, 0.0650, 30, 0.030, 0.0120, 1200,
     'v1', 1, 'migration:2026_06_19', 'BRRRR baseline (75% rule + refi).'),
    ('DEFAULT','auction',    'brrrr', 0.0100, 0.0800, 0.700, 45.00, 0.750, 1.250, 0.200, 0.0650, 30, 0.030, 0.0120, 1200,
     'v1', 1, 'migration:2026_06_19', 'BRRRR on auction inventory.'),
    ('DEFAULT','foreclosure','brrrr', 0.0100, 0.0750, 0.720, 45.00, 0.750, 1.250, 0.200, 0.0650, 30, 0.030, 0.0120, 1200,
     'v1', 1, 'migration:2026_06_19', 'BRRRR on foreclosure inventory.')
ON CONFLICT (property_type, sale_type, strategy) WHERE is_active AND effective_to IS NULL
DO UPDATE SET target_ratio = EXCLUDED.target_ratio, target_cap_rate = EXCLUDED.target_cap_rate,
    arv_discount = EXCLUDED.arv_discount, refi_ltv = EXCLUDED.refi_ltv, updated_at = now();

-- short-term rental — PLACEHOLDER: no STR revenue signal yet; provisional heuristic only.
INSERT INTO public.underwriting_rules
    (property_type, sale_type, strategy, str_adr, str_occupancy, str_target_cap_rate,
     down_payment_pct, interest_rate, loan_term_years, closing_cost_pct,
     property_tax_rate, insurance_annual, is_provisional,
     rule_version, rule_set_version, created_by, explanation)
VALUES
    ('DEFAULT','standard','str', NULL, 0.550, 0.0800, 0.200, 0.0650, 30, 0.030, 0.0120, 1200, TRUE,
     'v1', 1, 'migration:2026_06_19', 'PLACEHOLDER: no STR revenue signal; heuristic only.')
ON CONFLICT (property_type, sale_type, strategy) WHERE is_active AND effective_to IS NULL
DO UPDATE SET str_occupancy = EXCLUDED.str_occupancy, str_target_cap_rate = EXCLUDED.str_target_cap_rate,
    is_provisional = EXCLUDED.is_provisional, updated_at = now();

-- ---------------------------------------------------------------------------
-- resolve_rule(): one self-complete config row + the fallback tier that won.
-- Precedence: exact -> (type,standard) -> (DEFAULT,sale_type) -> (DEFAULT,standard).
-- Only active, in-effect rows are eligible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_rule(
    p_type     TEXT,
    p_sale     TEXT,
    p_strategy TEXT
)
RETURNS TABLE (
    rule_id BIGINT, resolved_tier TEXT, matched_property_type TEXT, matched_sale_type TEXT,
    strategy TEXT, target_ratio NUMERIC, min_gross_yield NUMERIC, target_grm NUMERIC,
    target_cap_rate NUMERIC, target_coc NUMERIC, min_dscr NUMERIC, min_debt_yield NUMERIC,
    max_price_to_rent NUMERIC, fifty_pct_opex_ratio NUMERIC, arv_discount NUMERIC,
    rehab_per_sqft NUMERIC, min_flip_roi NUMERIC, refi_ltv NUMERIC, str_adr NUMERIC,
    str_occupancy NUMERIC, str_target_cap_rate NUMERIC, down_payment_pct NUMERIC,
    interest_rate NUMERIC, loan_term_years INT, closing_cost_pct NUMERIC,
    property_tax_rate NUMERIC, insurance_annual NUMERIC, is_provisional BOOLEAN,
    rule_version TEXT, rule_set_version INTEGER
) AS $$
    WITH cand AS (
        SELECT * FROM (VALUES
            (COALESCE(NULLIF(UPPER(p_type),''),'DEFAULT'), p_sale,     1, 'exact'),
            (COALESCE(NULLIF(UPPER(p_type),''),'DEFAULT'), 'standard', 2, 'type_standard'),
            ('DEFAULT',                                    p_sale,     3, 'default_saletype'),
            ('DEFAULT',                                    'standard', 4, 'default_standard')
        ) AS t(mp, ms, ord, tier)
    )
    SELECT r.id,
        CASE
            WHEN r.property_type = COALESCE(NULLIF(UPPER(p_type),''),'DEFAULT') AND r.sale_type = p_sale THEN 'exact'
            WHEN r.property_type = COALESCE(NULLIF(UPPER(p_type),''),'DEFAULT') AND r.sale_type = 'standard' THEN 'type_standard'
            WHEN r.property_type = 'DEFAULT' AND r.sale_type = 'standard' THEN 'default_standard'
            ELSE 'default_saletype'
        END AS resolved_tier,
        r.property_type, r.sale_type,
        r.strategy, r.target_ratio, r.min_gross_yield, r.target_grm, r.target_cap_rate,
        r.target_coc, r.min_dscr, r.min_debt_yield, r.max_price_to_rent, r.fifty_pct_opex_ratio,
        r.arv_discount, r.rehab_per_sqft, r.min_flip_roi, r.refi_ltv, r.str_adr,
        r.str_occupancy, r.str_target_cap_rate, r.down_payment_pct, r.interest_rate,
        r.loan_term_years, r.closing_cost_pct, r.property_tax_rate, r.insurance_annual,
        r.is_provisional, r.rule_version, r.rule_set_version
    FROM cand c
    JOIN public.underwriting_rules r
      ON r.property_type = c.mp AND r.sale_type = c.ms AND r.strategy = p_strategy
     AND r.is_active AND r.effective_from <= now()
     AND (r.effective_to IS NULL OR r.effective_to > now())
    ORDER BY c.ord
    LIMIT 1;
$$ LANGUAGE sql STABLE;

-- resolve_rule_debug(): the full candidate chain (every tier that matched), for inspection.
CREATE OR REPLACE FUNCTION public.resolve_rule_debug(
    p_type     TEXT,
    p_sale     TEXT,
    p_strategy TEXT
)
RETURNS TABLE (ord INT, tier TEXT, matched_property_type TEXT, matched_sale_type TEXT,
               rule_id BIGINT, would_win BOOLEAN) AS $$
    WITH cand AS (
        SELECT * FROM (VALUES
            (COALESCE(NULLIF(UPPER(p_type),''),'DEFAULT'), p_sale,     1, 'exact'),
            (COALESCE(NULLIF(UPPER(p_type),''),'DEFAULT'), 'standard', 2, 'type_standard'),
            ('DEFAULT',                                    p_sale,     3, 'default_saletype'),
            ('DEFAULT',                                    'standard', 4, 'default_standard')
        ) AS t(mp, ms, ord, tier)
    ), matched AS (
        SELECT c.ord, c.tier, c.mp, c.ms, r.id AS rule_id
        FROM cand c
        JOIN public.underwriting_rules r
          ON r.property_type = c.mp AND r.sale_type = c.ms AND r.strategy = p_strategy
         AND r.is_active AND r.effective_from <= now()
         AND (r.effective_to IS NULL OR r.effective_to > now())
    )
    SELECT ord, tier, mp, ms, rule_id, ord = MIN(ord) OVER () AS would_win
    FROM matched ORDER BY ord;
$$ LANGUAGE sql STABLE;

COMMIT;
