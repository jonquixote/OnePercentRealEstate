# Out-of-band migration steps

These `.sql` files are **NOT** run by the migration runner (`pnpm migrate`) — the
runner only reads top-level `infrastructure/migrations/*.sql` and wraps each in a
single transaction. The steps here either cannot run inside a transaction
(`CREATE INDEX CONCURRENTLY`) or are long-running batched backfills that must
commit incrementally on the 3.5 GB `listings` table.

Run each by hand against prod (off-peak), in this order, **between** the normal
migrations noted:

| Order | File | When | Lock profile |
|------|------|------|--------------|
| 1 | `2026_06_20_backfill_sale_type.sql` | after `2026_06_20_listings_sale_type_column.sql` | batched, COMMIT per batch, `pg_sleep` between — light |
| 2 | `2026_06_20_validate_sale_type_check.sql` | after backfill | `SHARE UPDATE EXCLUSIVE` — does not block reads/writes |
| 3 | `2026_06_21_create_unique_index_concurrently.sql` | after backfill, before `2026_06_21_listings_swap_unique_constraint.sql` | `CONCURRENTLY` — does not block writes |
| 4 | (run normal migration `2026_06_21_listings_swap_unique_constraint.sql`) | after step 3 | brief `ACCESS EXCLUSIVE`, metadata-only |
| 5 | `2026_06_22_audit_sale_type.sql` | after everything | read-only |

How to run (example):

```bash
docker compose exec -T postgres psql -U <user> -d <db> \
  -f /path/to/2026_06_20_backfill_sale_type.sql
# the backfill defines a procedure; then:
docker compose exec -T postgres psql -U <user> -d <db> -c "CALL public.backfill_sale_type(5000, 0.2);"
```

The backfill is **resumable + idempotent**: it only touches rows where
`address_hash IS NULL`, commits per batch, and never writes
`estimated_rent` / `rent_calc_status` / `updated_at` (so the rent-calc queue and
the rent NOTIFY trigger are untouched).

## Transition bridge index (deploy ordering — IMPORTANT)

The constraint swap drops the unique index on `(address, listing_type)`. The
**old** scraper image (running until you deploy the new one) upserts with
`ON CONFLICT (address, listing_type)` and will 500 on every `/scrape` without a
matching index. A bridging unique index keeps it alive in the gap:

```sql
CREATE UNIQUE INDEX CONCURRENTLY listings_addr_type_bridge_uniq
  ON public.listings (address, listing_type);
```

This was created on prod immediately after the swap (2026-06-20) and the scraper
recovered. It is safe **only** while no address carries coexisting sale_types
(true until the new scraper's foreclosure pass runs).

**At code deploy**, the new scraper upserts with
`ON CONFLICT (address, listing_type, sale_type)` and creates coexisting
(standard + foreclosure) rows — which the 2-col bridge would reject. So drop it
as the new code goes live:
`out-of-band/2026_06_21_drop_bridge_index_at_deploy.sql`.

**Current prod state (2026-06-20):** all Wave A+B migrations applied + backfill
done + bridge index in place. Running containers are still on OLD code (forward
-compatible: they ignore the new columns/tables). Pending: deploy app + scraper +
worker, then drop the bridge index.

---

## 2026-07-14 — `idx_crawl_jobs_finished_at` (crawler stall/block alerting)

`2026_07_14_crawl_jobs_finished_at_idx.sql` — partial `CREATE INDEX CONCURRENTLY`
on `crawl_jobs (finished_at DESC) WHERE finished_at IS NOT NULL`. Supports the
`crawler_health` custom query in `infrastructure/monitoring/postgres-exporter/queries.yml`
(miss_streak / fail_streak scans). Independent of the sale_type sequence above;
run any time. Idempotent (`IF NOT EXISTS`).

```bash
psql "$DATABASE_URL" -f infrastructure/migrations/out-of-band/2026_07_14_crawl_jobs_finished_at_idx.sql
```

**Prod state:** already applied on the main server 2026-07-14.

---

## 2026-07-15 — `crawler_block_state` (block circuit-breaker signal) — ORDERING CRITICAL

`2026_07_15_crawler_block_state.sql` — creates the `crawler_block_state` singleton
table (+ GRANTs: `oper_worker` read/write, `oper_exporter` read). The crawl
worker's block circuit breaker writes this row; the `crawler_health` query in
`infrastructure/monitoring/postgres-exporter/queries.yml` reads it via the
`block_cooloff_active` column, which powers the `CrawlerBlockCooloff` alert.

**Why ordering is critical:** postgres-exporter fails the ENTIRE scrape (every
custom metric, and the target goes DOWN) if any one query errors. The new
`block_cooloff_active` subquery references `crawler_block_state` directly, so a
missing table is a hard parse error — `COALESCE`/`to_regclass` guards do **not**
help (Postgres still parses the inner reference). Therefore:

> **Apply this migration BEFORE deploying the updated `queries.yml` / restarting
> postgres-exporter.** If the exporter is restarted first, it takes down all
> custom crawler metrics AND `pg_up` for the target until the table exists.

Idempotent (`CREATE TABLE IF NOT EXISTS` + `INSERT ... ON CONFLICT DO NOTHING`);
run any time, but sequence it ahead of the exporter reload.

```bash
psql "$DATABASE_URL" -f infrastructure/migrations/out-of-band/2026_07_15_crawler_block_state.sql
```

**Prod state:** already applied on the main server 2026-07-15 (before the
`queries.yml` reload).
