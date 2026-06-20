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
