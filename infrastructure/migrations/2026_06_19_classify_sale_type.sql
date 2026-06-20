-- 2026_06_19_classify_sale_type.sql
-- Distress sale-type classification with provenance.
--
-- Returns the sale_type label PLUS why it was chosen (source + matched signal),
-- so the classification is inspectable. Text-only here ('text_classifier');
-- the scraper layers the homeharvest foreclosure flag on top as ground truth
-- (source 'homeharvest_flag') and a human can set 'manual_override'.
--
-- Precedence (most-specific / most-distressed end-state wins):
--   reo > auction > short_sale > pre_foreclosure > foreclosure > standard
-- Word-boundary regex (\m..\M) avoids matching "auctioneer" in agent bios etc.

BEGIN;

CREATE OR REPLACE FUNCTION public.classify_sale_type(
    p_raw  JSONB,
    p_type TEXT DEFAULT NULL
)
RETURNS TABLE (sale_type TEXT, sale_type_source TEXT, sale_type_signal TEXT) AS $$
DECLARE
    t TEXT := lower(
        coalesce(p_raw->>'text','')   || ' ' ||
        coalesce(p_raw->>'mls_status','') || ' ' ||
        coalesce(p_raw->>'status','')     || ' ' ||
        coalesce(p_raw->>'flags','')
    );
BEGIN
    IF t ~ '\m(reo|real estate owned|bank[ -]?owned|lender[ -]?owned)\M' THEN
        RETURN QUERY SELECT 'reo', 'text_classifier', 'reo/bank-owned';
    ELSIF t ~ '\m(auction)\M' THEN
        RETURN QUERY SELECT 'auction', 'text_classifier', 'auction';
    ELSIF t ~ '\m(short[ -]?sale)\M' THEN
        RETURN QUERY SELECT 'short_sale', 'text_classifier', 'short sale';
    ELSIF t ~ '\m(pre[ -]?foreclosure|notice of default|lis pendens)\M' THEN
        RETURN QUERY SELECT 'pre_foreclosure', 'text_classifier', 'pre-foreclosure/NOD';
    ELSIF t ~ '\m(foreclosure|foreclos\w*)\M' THEN
        RETURN QUERY SELECT 'foreclosure', 'text_classifier', 'foreclosure';
    ELSE
        RETURN QUERY SELECT 'standard', NULL::TEXT, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMIT;
