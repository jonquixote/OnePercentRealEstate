-- 2026_06_20_classify_sale_type_v2.sql
-- Harden classify_sale_type (audit findings):
--   * detect homeharvest's structured flags.is_foreclosure boolean (the \m..\M
--     word boundary treats '_' as a word char, so '\mforeclosure' never matched
--     inside "is_foreclosure" — the structured signal was silently inert).
--   * widen stems to catch plural/verb forms: auctions/auctioned, reos,
--     short sales, foreclosures/foreclosed, pre-foreclosures.
--   * populate sale_type_confidence (structured flag > structured text > free text)
--     so provenance is complete, not a NULL column.
--
-- New 4-column signature (adds sale_type_confidence). Callers (scraper INSERT,
-- backfill/reclassify) are updated in lockstep.

BEGIN;

DROP FUNCTION IF EXISTS public.classify_sale_type(jsonb, text);

CREATE OR REPLACE FUNCTION public.classify_sale_type(
    p_raw  JSONB,
    p_type TEXT DEFAULT NULL   -- accepted for call-site symmetry; not used
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
    -- precedence: most-distressed / most-specific end-state wins
    IF t ~ '\m(reo|real estate owned|bank[ -]?owned|lender[ -]?owned)\M' THEN
        v_type := 'reo'; v_sig := 'reo/bank-owned';
    ELSIF t ~ '\m(auction\w*)\M' THEN
        v_type := 'auction'; v_sig := 'auction';
    ELSIF t ~ '\m(short[ -]?sale\w*)\M' THEN
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

    -- confidence: structured boolean flag strongest, then a structured-field
    -- text match, then a free-text-description-only match.
    IF is_fc AND v_type = 'foreclosure' THEN
        v_conf := 0.95;
    ELSIF structured ~ '\m(reo|real estate owned|bank[ -]?owned|lender[ -]?owned|auction\w*|short[ -]?sale\w*|pre[ -]?foreclosure\w*|notice of default|lis pendens|foreclos\w*)\M' THEN
        v_conf := 0.85;
    ELSE
        v_conf := 0.60;
    END IF;

    RETURN QUERY SELECT v_type, 'text_classifier', v_sig, v_conf;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMIT;
