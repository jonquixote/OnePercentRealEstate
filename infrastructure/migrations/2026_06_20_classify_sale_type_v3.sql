-- 2026_06_20_classify_sale_type_v3.sql
-- Fix v2 stem over/under-matching (re-audit findings):
--   * 'auction\w*' matched "auctioneer" (false positive) → 'auction(s|ed|ing)?'
--     matches auction/auctions/auctioned/auctioning but NOT auctioneer.
--   * 'reo' had no plural stem → 'reos?' so "reos" matches.
--   * short_sale stem tightened to 'short[ -]?sales?' (no trailing \w* over-match).
-- Same 4-column signature as v2; CREATE OR REPLACE.

BEGIN;

CREATE OR REPLACE FUNCTION public.classify_sale_type(
    p_raw  JSONB,
    p_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    sale_type            TEXT,
    sale_type_source     TEXT,
    sale_type_signal     TEXT,
    sale_type_confidence NUMERIC
) AS $$
DECLARE
    structured TEXT := lower(
        coalesce(p_raw->>'mls_status','') || ' ' ||
        coalesce(p_raw->>'status','')     || ' ' ||
        coalesce(p_raw->>'flags','')
    );
    freetext TEXT := lower(coalesce(p_raw->>'text',''));
    is_fc    BOOLEAN := coalesce((p_raw->'flags'->>'is_foreclosure')::boolean, false);
    t        TEXT := structured || ' ' || freetext;
    v_type   TEXT;
    v_sig    TEXT;
    v_conf   NUMERIC;
BEGIN
    IF t ~ '\m(reos?|real estate owned|bank[ -]?owned|lender[ -]?owned)\M' THEN
        v_type := 'reo'; v_sig := 'reo/bank-owned';
    ELSIF t ~ '\m(auction(s|ed|ing)?)\M' THEN
        v_type := 'auction'; v_sig := 'auction';
    ELSIF t ~ '\m(short[ -]?sales?)\M' THEN
        v_type := 'short_sale'; v_sig := 'short sale';
    ELSIF t ~ '\m(pre[ -]?foreclosure\w*|notice of default|lis pendens)\M' THEN
        v_type := 'pre_foreclosure'; v_sig := 'pre-foreclosure/nod';
    ELSIF is_fc OR t ~ '\m(foreclos\w*)\M' THEN
        v_type := 'foreclosure';
        v_sig  := CASE WHEN is_fc THEN 'is_foreclosure flag' ELSE 'foreclosure' END;
    ELSE
        v_type := 'standard';
    END IF;

    IF v_type = 'standard' THEN
        RETURN QUERY SELECT 'standard', NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
        RETURN;
    END IF;

    IF is_fc AND v_type = 'foreclosure' THEN
        v_conf := 0.95;
    ELSIF structured ~ '\m(reos?|real estate owned|bank[ -]?owned|lender[ -]?owned|auction(s|ed|ing)?|short[ -]?sales?|pre[ -]?foreclosure\w*|notice of default|lis pendens|foreclos\w*)\M' THEN
        v_conf := 0.85;
    ELSE
        v_conf := 0.60;
    END IF;

    RETURN QUERY SELECT v_type, 'text_classifier', v_sig, v_conf;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMIT;
