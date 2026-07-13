-- Terminal screens (W1) re-key on login/signup alongside saved_searches, PLUS
-- the screen_alerts re-key from AL1.
--
-- Append-only: the DB is treated as already-migrated, so we cannot edit
-- 2026_07_12_identity_claim.sql in place. This file sorts AFTER
-- 2026_07_12_screen_alerts_claim.sql, so its CREATE OR REPLACE is the LAST one
-- applied and must contain the FULL function body (saved_searches +
-- terminal_screens + screen_alerts). If a later claim migration is added it
-- must also carry all three re-key blocks so the final applied definition is
-- complete.
--
-- Each re-key mirrors the saved_searches pattern: skip any (user_id, name) /
-- (user_id, screen_id) that would collide with an existing account row,
-- leaving the older anon row in place. Idempotent: a second call finds no
-- rows owned by the anon id.

CREATE OR REPLACE FUNCTION claim_anon_identity(p_account text, p_anon text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  n int := 0;
  _rc int := 0;
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
  GET DIAGNOSTICS _rc = ROW_COUNT;
  n := n + _rc;

   -- Only re-key alerts whose screen actually transferred to the account
   -- (terminal_screens re-key, above, leaves an anon screen in place when the
   -- account already owns one by name). Re-keying an alert whose screen is
   -- still anon-owned would orphan it onto an account that doesn't own the
   -- screen, so we gate on the screen_id now belonging to p_account.
   UPDATE screen_alerts sa
      SET user_id = p_account
    WHERE sa.user_id = p_anon
      AND EXISTS (
        SELECT 1 FROM terminal_screens t
         WHERE t.id = sa.screen_id AND t.user_id = p_account
      )
      AND NOT EXISTS (
        SELECT 1 FROM screen_alerts sa2
         WHERE sa2.user_id = p_account AND sa2.screen_id = sa.screen_id
      );
   GET DIAGNOSTICS _rc = ROW_COUNT;
   n := n + _rc;

  RETURN n;
END;
$$;
