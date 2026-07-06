# Wave 0 — Secrets Rotation (owner actions)

All four leaked/placeholder secrets from the Wave-7 open-items list, with
exact commands. Rotate in this order; each is independent.

## 1. n8n Postgres password (leaked at commit d2d24dc)

    ssh root@209.94.61.108
    docker exec infrastructure-postgres-1 psql -U postgres -c "ALTER USER n8n WITH PASSWORD '<NEW_PASSWORD>';"
    # update /opt/onepercent/.env -> the n8n DB_POSTGRESDB_PASSWORD (or equivalent) line
    cd /opt/onepercent && ./infrastructure/deploy.sh up -d --no-deps n8n
    # verify: docker logs infrastructure-n8n-1 --tail 20 (no auth errors)

## 2. FRED API key — ⚠ GATES WAVE 3

Old key is exposed in git history. Create a new key at
https://fred.stlouisfed.org/docs/api/api_key.html, then on the server:
update FRED_API_KEY in /opt/onepercent/.env and restart the app:

    cd /opt/onepercent && ./infrastructure/deploy.sh up -d --no-deps app

Verify: curl -s http://localhost:3001/api/mortgage-rates → real rates, not an error.
**Wave 3 (underwriting truth) will not deploy until this works** — the plan
treats the hardcoded-rate fallback as a blocker, not a degradation.

## 3. Server root password

    passwd   # on the server; store in your password manager
    # Preferred: disable password SSH entirely (key auth already in use):
    # /etc/ssh/sshd_config -> PasswordAuthentication no; systemctl reload sshd

## 4. Stripe

- Rotate the live secret key in the Stripe dashboard (Developers → API keys → roll).
- Replace STRIPE_PRICE_MONTHLY=PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD in
  /opt/onepercent/.env with the real price id (needed by Wave 5, not before).
- Restart app + worker containers after .env changes (same compose command as #2).

---

## Status

Owner-driven. None of these block Wave 0 completion. **FRED (#2) blocks the
Wave 3 deploy.** Track completion here as each is done:

- [ ] n8n Postgres password rotated
- [ ] FRED API key rotated (⚠ gates Wave 3)
- [ ] Server root password rotated / password-auth disabled
- [ ] Stripe live key rolled + real STRIPE_PRICE_MONTHLY set (needed for Wave 5)
