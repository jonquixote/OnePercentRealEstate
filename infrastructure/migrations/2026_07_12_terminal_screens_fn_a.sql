-- Task AL1 (append-only): extend claim_anon_identity to re-key screen_alerts
-- alongside saved_searches and terminal_screens, so a user's anonymous
-- screen alerts survive login/signup.
--
-- This is a NEW migration (the prior 2026_07_12_terminal_screens_claim.sql is
-- already applied and tracked in schema_migrations, so it cannot be edited in
-- place). We re-define the full function body — saved_searches + terminal_screens
-- + screen_alerts — so the screen_alerts block is not lost.
--
-- terminal_screens rows are re-keyed first (in the prior migration / here),
-- then screen_alerts follows their now-account-owned screen_id. We dedup on
-- (user_id, screen_id): if the account already alerts on the same screen we
-- keep the account's existing row and leave the anon alert in place.

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
   GET DIAGNOSTICS n = n + ROW_COUNT;

  RETURN n;
END;
$$;
