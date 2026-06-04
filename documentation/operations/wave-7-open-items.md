# Wave 7 — Open items

Inherited TODOs from
[`vps_deployment_guide.md`](./vps_deployment_guide.md)
plus the new items introduced by Wave 7 scaffolding.

Track here, not in code comments — that way a single grep for
"wave-7" tells you what's outstanding.

## Owner actions (you)

- [ ] **URGENT — Rotate the `n8n` Postgres password** (committed in plaintext at commit `d2d24dc` in `infrastructure/n8n_credentials/postgres.json`; removed from index 2026-06-03 but the value remains in git history). Steps:
  1. In the postgres container: `ALTER USER n8n PASSWORD '<NEW>';`
  2. Update `/opt/onepercent/.env` `N8N_DB_PASSWORD=<NEW>`.
  3. Recreate the n8n service: `docker compose -f infrastructure/docker-compose.yml up -d --no-deps n8n`.
  4. Optionally purge git history (see `infrastructure/n8n_credentials/README.md` → "Optional: purge history").

- [ ] **URGENT — Rotate the FRED API key** (`95f42f356f5131f13257eac54897e96a` was committed at the previous fallback in `apps/one/src/app/api/mortgage-rates/route.ts`; the fallback was removed and the key now fails closed if `FRED_API_KEY` is unset). Steps:
  1. FRED account → Account → API keys → rotate.
  2. Update `/opt/onepercent/.env` `FRED_API_KEY=<NEW>`.
  3. Restart app: `docker compose -f infrastructure/docker-compose.yml up -d --no-deps app`.

- [ ] Rotate server root password
  - Where: Linode dashboard → onepercent-prod → Settings → Reset Root Password
  - Why: was pasted in chat before the VPS guide existed
  - After: update `~/.ssh/config` if it embedded the old password

- [ ] Rotate Stripe live secret key
  - Where: Stripe dashboard → Developers → API keys → roll
  - After: `scp` the new `.env` to `/opt/onepercent/.env`, then
    `docker compose ... up -d --no-deps app`

- [ ] Replace `STRIPE_PRICE_*` placeholders in `.env`
  - Currently set to `PLACEHOLDER_GET_FROM_STRIPE_DASHBOARD`
  - Locations: pro tier, free tier (if introduced)
  - Where: Stripe dashboard → Products → copy the `price_...` IDs

- [ ] Decide on the Vercel commit status check
  - Today: it's a separate Vercel integration that just stamps a
    status on the GitHub commit. The real deploy is Linode.
  - Option A: keep it (cheap insurance that the build is portable)
  - Option B: remove the Vercel integration entirely
  - Recommend A until/unless it gets noisy.

- [ ] Set up the B2 bucket + pgbackrest
  - Runbook: [`infrastructure/backup/setup-pgbackrest.md`](../../infrastructure/backup/setup-pgbackrest.md)
  - Blocks the first DR drill.

- [ ] Wire the monitoring stack into `docker-compose.yml`
  - Snippet: [`infrastructure/monitoring/README.md`](../../infrastructure/monitoring/README.md)
  - Adds 5 services (prometheus, alertmanager, cadvisor,
    postgres-exporter, redis-exporter, grafana). Roughly 600 MB of
    extra RAM on the 16 GB VPS.

- [ ] Add a `grafana.octavo.press` DNS record + nginx site
  - Only after Grafana is up. Mirror the `n8n` site config.

- [ ] Schedule the first quarterly DR drill
  - Target date: **2026-09-01**
  - Checklist: [`documentation/operations/dr-runbook.md#quarterly-drill-checklist`](./dr-runbook.md#quarterly-drill-checklist)

## Follow-up engineering (later waves)

- [ ] Instrument `apps/one` and `apps/two` with prom-client at
      `/api/metrics`. The Prometheus scrape config has the jobs
      pre-scaffolded but commented.
- [ ] Add the `crawl_jobs` custom query to postgres-exporter's
      `queries.yml`. Snippet in
      [`alerts.yml`](../../infrastructure/monitoring/prometheus/rules/alerts.yml)
      at the bottom.
- [ ] Add prometheus_client middleware to the FastAPI scraper.
- [ ] Add a second SSH key holder so DR doesn't have a single point
      of human failure.
- [ ] Back up `n8n_data` volume to B2 (today only Postgres is in
      pgbackrest). Workflows are version-controlled in
      `infrastructure/n8n_workflow_*.json` so the gap is small.

## Status

This document is the source of truth for Wave 7 follow-ups. When an
item closes, strike it and add a note (e.g. "done 2026-MM-DD, see
PR #N"). Do not delete — the history is useful at the next quarterly
review.
