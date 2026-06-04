# Wave 3 — Async rent pipeline + model registry + drift

## What landed

- **`_backend/` renamed to `services/`** via `git mv`. All compose,
  Dockerfile, shell, and TS references updated. The docker-compose
  network name `infrastructure_backend` stays the same — that's the
  compose-project-prefixed network name, not a folder.
- **`infrastructure/migrations/2026_06_03_rent_calc_async.sql`** drops the
  synchronous `set_smart_rent_estimate` BEFORE INSERT/UPDATE trigger from
  `listings`, adds `rent_calc_status` (`pending`/`done`/`failed`) and
  `rent_model_version` columns, and replaces the old trigger with an
  AFTER INSERT trigger that emits `pg_notify('rent_job_enqueued', ...)`.
  The legacy `calculate_smart_rent` SQL function body stays in place as
  a fallback. Existing rows are backfilled so the worker drains the
  current pending set on first boot.
- **`infrastructure/migrations/2026_06_03_rent_model_registry.sql`**
  creates `rent_models` (with a unique-active partial index) and
  `rent_predictions_audit`. A baseline row `v0` is seeded as active so
  the first prediction after the migration has a real version to stamp.
- **`apps/worker/src/rent-estimator.ts`** is the Node async worker. It
  LISTENs on `rent_job_enqueued`, drains pending rows on connect (and
  on every reconnect — the same crawl.ts pattern), POSTs each listing
  to the `ml` service's `/predict`, writes back
  `estimated_rent` + `rent_calc_status='done'` + `rent_model_version`,
  and appends a row to `rent_predictions_audit`. Imports
  `env.ts`/`logger.ts` from the Wave 2 crawl worker rather than
  duplicating them.
- **`services/ml/`** is a new FastAPI service. `main.py` wraps
  `services/rent_estimator_v2.estimate_rent_v2(...)` behind a single
  `POST /predict` endpoint that reads the active model version from
  `rent_models` and stamps it on every response. `eval.py` and
  `drift.py` are CLIs invoked as `python -m services.ml.eval` and
  `python -m services.ml.drift`; drift exits non-zero when PSI > 0.2 so
  cron + alertmanager can fire on it.
- **docker-compose** gets two new services: `worker-rent` (the Node
  worker, sharing the `apps/worker` image with the Wave 2 crawl
  worker but with a `command:` override) and `ml` (FastAPI on
  `127.0.0.1:8002` → container 8000).

## n8n: no workflow change needed

The existing scraper pipeline (`n8n_workflow_with_rentals.json`) calls
into the FastAPI scraper, which inserts rows into `listings`. Before
Wave 3, the synchronous trigger filled `estimated_rent` inline; after
Wave 3, the AFTER INSERT trigger emits a notification and the Node
rent-estimator worker fills it asynchronously. From n8n's point of view
nothing changed — the same workflow keeps working. The n8n JSON files
are intentionally left untouched.

## Deploying the migrations

Migrations are additive and safe (the trigger is dropped but the
function body is intact; `estimated_rent` is now NULL on fresh inserts,
which the generated `rent_price_ratio STORED` column tolerates per the
Wave 1 schema).

```bash
rsync -avz -e ssh \
  infrastructure/migrations/2026_06_03_rent_calc_async.sql \
  infrastructure/migrations/2026_06_03_rent_model_registry.sql \
  onepercent-prod:/opt/onepercent/infrastructure/migrations/

ssh onepercent-prod 'docker exec -i infrastructure-postgres-1 \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f /dev/stdin < /opt/onepercent/infrastructure/migrations/2026_06_03_rent_calc_async.sql'

ssh onepercent-prod 'docker exec infrastructure-postgres-1 \
  psql -U postgres -d postgres \
  -c "INSERT INTO schema_migrations (version) VALUES ('"'"'2026_06_03_rent_calc_async'"'"') ON CONFLICT DO NOTHING"'

# repeat for rent_model_registry
```

The Node worker + ML service should NOT be deployed in the same change
window as the migrations. Apply migrations, verify the column adds
landed and the trigger swap is correct, then deploy the
`worker-rent` + `ml` containers in a second step.

## Rolling back

1. `DROP TRIGGER trg_rent_job_enqueue ON listings;`
2. Recreate `set_smart_rent_estimate` from
   `infrastructure/rent_estimation_trigger.sql` (untouched in Wave 3 —
   it's still the source of truth for the legacy trigger body).
3. `ALTER TABLE listings DROP COLUMN rent_calc_status, DROP COLUMN
   rent_model_version;` if you want a full revert; or leave the columns
   in place since they're nullable and don't break the legacy read path.
4. Stop the `worker-rent` and `ml` compose services.

The `rent_models` / `rent_predictions_audit` tables can stay — they're
additive and don't affect any other path.
