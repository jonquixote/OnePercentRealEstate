# Database Migrations

This directory holds incremental SQL migrations applied to the Postgres database. The runner is a small TypeScript script at `src/scripts/migrate.ts` that:

1. Creates a `schema_migrations` tracking table if it does not exist
2. Reads `infrastructure/migrations/*.sql` in **alphabetical order**
3. Skips any file whose name (minus `.sql`) is already recorded in `schema_migrations`
4. Runs each pending migration inside a single transaction, inserting the version row only on success
5. Rolls back and aborts the run on the first failure

## Filename convention

Use a sortable, date-prefixed name so the runner's alphabetical sort is also a sensible application order:

```
YYYY_MM_DD_short_snake_case_description.sql
```

Examples:

- `2026_05_31_add_rent_price_ratio.sql`
- `2026_06_15_create_user_sessions.sql`

## Authoring rules

- **Idempotent where possible.** Prefer `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. This lets the same migration be re-applied manually in emergencies without crashing the DB.
- **One logical change per file.** Easier to review, easier to roll back.
- **No data migrations mixed with schema changes** unless unavoidable. Keep the change small enough to fit in a single transaction.
- **Use the existing schema conventions** from `infrastructure/000_base_schema.sql` (snake_case columns, `TIMESTAMPTZ` defaults, `JSONB` defaults of `'{}'` or `'[]'`).

## How to add a new migration

1. Create a new `.sql` file in this directory following the naming convention above.
2. Write the SQL using idempotent guards where reasonable.
3. Run it locally:

   ```bash
   npm run migrate
   ```

4. Check the current state of the DB at any time:

   ```bash
   npm run migrate:status
   ```

5. Commit the `.sql` file alongside the application code that depends on the schema change.

## Tooling notes

The runner is a zero-dependency Node 22+ script that uses `node --env-file=.env --experimental-strip-types`. It reads `DATABASE_URL` from `.env` and connects with `pg` (already a runtime dep). No new npm packages are required.
