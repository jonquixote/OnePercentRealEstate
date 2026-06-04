# Wave 2 — n8n → worker handoff for crawl-job draining

## What changed

Before Wave 2 the crawl-job pipeline was:

```
n8n (every 30s) → "Get Next Job" SQL → "Scrape For Sale" HTTP → "Mark Complete" SQL
```

After Wave 2 the same pipeline is:

```
INSERT INTO crawl_jobs        → AFTER INSERT trigger emits NOTIFY crawl_job_enqueued
crawl_job_enqueued payload    → apps/worker (LISTEN) claims the row → POST scraper → UPDATE
n8n cron                      → still owns scheduling new INSERTs into crawl_jobs
```

Drain latency drops from ~15s avg (half the 30s poll window) to <1s.

## What the n8n workflow still owns

- **Scheduling.** The Cron node that runs every X minutes and inserts new
  `crawl_jobs` rows is unchanged — n8n is still the cheapest way to schedule.
- **Manual one-shot triggers.** Anyone using the n8n UI to fire a one-off
  job still works the same way.

## What the n8n workflow MUST stop doing

The "Get Next Job" / "Scrape For Sale" / "Mark Complete" branch is now
duplicate work — the worker will claim the same row, then n8n's claim
will fail (it uses `FOR UPDATE SKIP LOCKED` so this is safe, just
wasteful) or worse, n8n will re-run a scrape the worker already finished.

## How to disable the draining branch in n8n (UI steps)

1. SSH-tunnel to the n8n UI at `https://n8n.octavo.press`. Log in with
   the `admin` user (password in the prod `.env` as `N8N_PASSWORD`).
2. Open the **`Property Scraper`** workflow (the one defined by
   `infrastructure/n8n_workflow_with_rentals.json`).
3. Find the "Get Next Job" node (Postgres node, runs the
   `UPDATE crawl_jobs SET status='processing' ... RETURNING *` query).
4. **Option A — surgical:** right-click the "Get Next Job" node →
   **Disable**. Then disable "Scrape For Sale", "Scrape For Rent" (if
   present), and "Mark Complete" too. Save the workflow. The Cron node
   that inserts new rows stays enabled.
5. **Option B — coarse:** if you want to validate the worker for a
   week before disabling anything in n8n, leave the workflow alone.
   The worker is idempotent at the row level (atomic claim via
   `UPDATE ... WHERE status='pending' RETURNING *`) so the only
   downside is duplicate scrape HTTP calls — wasteful but not
   incorrect. The `recycle_stuck_jobs()` function in the DB and the
   `trigger_recycle_crawl_jobs` trigger continue to work either way.

## Why NOT modify `n8n_workflow_with_rentals.json` in this repo

The JSON file in this repo is the **initial seed** for n8n. n8n owns
the runtime copy in its Postgres tables once imported. Re-importing
would overwrite credentials (Postgres connection auth, basic-auth
secrets), workflow IDs, and execution history. Disable in the UI
instead.

## Rollback

If the worker misbehaves and we need to fall back to n8n polling:

1. In docker-compose: `docker compose stop worker worker-refresh`.
2. In the n8n UI: re-enable the "Get Next Job" / "Scrape For Sale" /
   "Mark Complete" nodes. Save.
3. The `NOTIFY crawl_job_enqueued` trigger is harmless when nothing
   subscribes — it's a no-op.

## Verification

After the worker is up on prod:

```bash
ssh onepercent-prod 'docker exec infrastructure-postgres-1 \
  psql -U postgres -c "INSERT INTO crawl_jobs (region_type, region_value) VALUES (\$\$zip\$\$, \$\$33611\$\$);"'

# Then within ~1s:
ssh onepercent-prod 'docker logs --since=10s infrastructure-worker-1 2>&1 | grep "claimed crawl job"'
```

If you see a `claimed crawl job` log line referencing the row id you
just inserted, the LISTEN path is healthy.

## Related code

- Migration: `infrastructure/migrations/2026_06_03_crawl_jobs_notify.sql`
- Worker:    `apps/worker/src/crawl.ts`
- Compose:   `infrastructure/docker-compose.yml` (the `worker` service)
