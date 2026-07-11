-- Growth & Durability (Phase 1.1): claim anonymous saved searches on login/signup.
--
-- Historical context: saved searches were keyed on a localStorage UUID
-- ("oper:user_id") before real auth existed. Now that accounts are real,
-- signing in should re-key that UUID's saved_searches rows to the account
-- id so a user's anonymous saves survive registration. Watchlists were
-- always session-scoped, so nothing to re-key there.
--
-- claim_anon_identity is idempotent: a second call finds no rows owned by
-- the anon id. It skips any (user_id, name) that would collide with an
-- existing account search, leaving the older anon row in place rather than
-- erroring on the unique index.

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
  RETURN n;
END;
$$;
