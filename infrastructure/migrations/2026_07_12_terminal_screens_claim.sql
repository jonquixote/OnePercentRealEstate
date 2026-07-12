-- Terminal screens (W1) re-key on login/signup alongside saved_searches.
--
-- Append-only: the DB is treated as already-migrated, so we cannot edit
-- 2026_07_12_identity_claim.sql in place. We re-define claim_anon_identity
-- here with the SAME body plus a terminal_screens re-key block that mirrors
-- the saved_searches pattern (skip any (user_id, name) that would collide
-- with an existing account screen, leaving the older anon row in place).
-- Idempotent: a second call finds no rows owned by the anon id.

CREATE OR REPLACE FUNCTION claim_anon_identity(p_account text, p_anon text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
BEGIN
  IF p_account IS NULL OR p_anon IS NULL OR p_account = p_anon THEN
    RETURN 0;
  END IF;

  UPDATE saved_searches s
     SET user_id = p_account
   WHERE s.user_id = p_anon
     AND NOT EXISTS (
       SELECT 1 FROM saved_searches s2
        WHERE s2.user_id = p_account AND s2.name = s.name
     );
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE terminal_screens t
     SET user_id = p_account
   WHERE t.user_id = p_anon
     AND NOT EXISTS (
       SELECT 1 FROM terminal_screens t2
        WHERE t2.user_id = p_account AND t2.name = t.name
     );

  GET DIAGNOSTICS n = n + ROW_COUNT;
  RETURN n;
END;
$$;
