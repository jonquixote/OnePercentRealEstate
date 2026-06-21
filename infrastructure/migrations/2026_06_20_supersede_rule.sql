-- 2026_06_20_supersede_rule.sql
-- Lifecycle versioning for underwriting_rules. The columns (effective_from/to,
-- is_active, rule_set_version) existed but nothing wrote them post-seed, so rule
-- evolution wasn't auditable. supersede_rule() closes the current active row
-- (is_active=false, effective_to=now) and inserts a NEW active version carrying
-- the old values forward with JSONB overrides applied — preserving history.
--
-- Usage:
--   SELECT supersede_rule('MULTI_FAMILY','standard','buy_hold',
--                         '{"target_ratio":0.013,"target_cap_rate":0.075}'::jsonb,
--                         'jehawley');

BEGIN;

CREATE OR REPLACE FUNCTION public.supersede_rule(
    p_type      TEXT,
    p_sale      TEXT,
    p_strategy  TEXT,
    p_overrides JSONB,
    p_by        TEXT DEFAULT 'api'
)
RETURNS BIGINT AS $$
DECLARE
    v_old public.underwriting_rules;
    nr    public.underwriting_rules;
    v_id  BIGINT;
BEGIN
    SELECT * INTO v_old
    FROM public.underwriting_rules
    WHERE property_type = p_type AND sale_type = p_sale AND strategy = p_strategy
      AND is_active AND effective_to IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'supersede_rule: no active rule for (%, %, %)', p_type, p_sale, p_strategy;
    END IF;

    UPDATE public.underwriting_rules
    SET is_active = false, effective_to = now(), updated_at = now()
    WHERE id = v_old.id;

    nr := jsonb_populate_record(v_old, p_overrides);  -- old values + overrides

    INSERT INTO public.underwriting_rules (
        property_type, sale_type, strategy, target_ratio, min_gross_yield, target_grm, target_cap_rate,
        target_coc, min_dscr, min_debt_yield, max_price_to_rent, fifty_pct_opex_ratio, arv_discount,
        rehab_per_sqft, min_flip_roi, refi_ltv, str_adr, str_occupancy, str_target_cap_rate,
        down_payment_pct, interest_rate, loan_term_years, closing_cost_pct, property_tax_rate, insurance_annual,
        effective_from, effective_to, is_active, is_provisional, rule_version, rule_set_version, created_by, explanation
    ) VALUES (
        nr.property_type, nr.sale_type, nr.strategy, nr.target_ratio, nr.min_gross_yield, nr.target_grm, nr.target_cap_rate,
        nr.target_coc, nr.min_dscr, nr.min_debt_yield, nr.max_price_to_rent, nr.fifty_pct_opex_ratio, nr.arv_discount,
        nr.rehab_per_sqft, nr.min_flip_roi, nr.refi_ltv, nr.str_adr, nr.str_occupancy, nr.str_target_cap_rate,
        nr.down_payment_pct, nr.interest_rate, nr.loan_term_years, nr.closing_cost_pct, nr.property_tax_rate, nr.insurance_annual,
        now(), NULL, true, nr.is_provisional, nr.rule_version, coalesce(v_old.rule_set_version, 1) + 1, p_by, nr.explanation
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMIT;
