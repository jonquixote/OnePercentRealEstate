# pgbackrest activation — status (Wave 0, Task 9)

**Not activated this wave. Deliberately deferred — see blockers. The nightly
`pg_dump` stopgap (`infrastructure/scripts/pg-backup.sh`) is the active,
tested safety net (RPO ≤24 h, restore proven at 233 s / 943K rows).**

## Blockers

1. **Offsite bucket is owner-gated.** `infrastructure/backup/setup-pgbackrest.md`
   and `pgbackrest.conf` are built around a Backblaze B2 S3 repo. No bucket /
   application key exists yet (spec §7 item 3 — owner decision). Without it there
   is no offsite target, which is the whole point of pgbackrest over the local dump.

2. **WAL archiving conflicts with the containerized Postgres, and the runbook
   doesn't resolve it.** Step 6 appends
   `archive_command = 'pgbackrest --stanza=oper archive-push %p'` to
   `postgresql.conf`. That command executes **inside** the `infrastructure-postgres-1`
   container, but pgbackrest is installed as a **host** package (the runbook's own
   design choice, step "on the host, not in the container"). The container has no
   `pgbackrest` binary, so `archive_command` would fail on every WAL segment.
   pgbackrest online `backup` in turn requires working archiving, so a full backup
   cannot complete cleanly in this topology as written.

   Resolving it is a real decision, not an improvisation:
   - **(a) Bake pgbackrest into the Postgres image** — `archive_command` works
     in-container; host runs `backup` against a bind-mounted `pg1-path`. Couples
     backup tooling to image builds.
   - **(b) Sidecar container** sharing the data volume, running `archive-push`.
   - **(c) Managed WAL shipping** (e.g. wal-g in-image) — different tool.

3. **Data-dir bind-mount migration is high-risk to run late in a session.** Step 3
   requires stopping Postgres and rsyncing the live data directory out of the docker
   volume, right after this wave already restarted Postgres for tuning. Not worth
   stacking onto the same window.

## Decision

Ship pgbackrest as a **follow-up PR** once the owner provisions the B2 bucket. At
that point, pick option (a) or (b) for WAL archiving, do the bind-mount migration in
its own maintenance window, and follow `setup-pgbackrest.md` from step 4. Until then,
the nightly `pg_dump` (7-day local rotation, root-only perms, integrity-gated, cron
03:17 UTC) is the backup of record. Wave 8's DR drill exercises restore from it.

## Owner action

- [ ] Provision Backblaze B2 bucket `octavo-pg-backups` + application key (spec §7 item 3).
- [ ] Decide WAL-archiving topology (a/b/c above).
