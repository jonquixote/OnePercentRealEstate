# Disaster Recovery Runbook

Last reviewed: 2026-06-02.

This runbook covers the three realistic failure modes for the
OnePercentRealEstate production stack. It assumes pgbackrest is wired
up per
[`infrastructure/backup/setup-pgbackrest.md`](../../infrastructure/backup/setup-pgbackrest.md)
and that the B2 bucket `octavo-pg-backups` is reachable.

For ambient infrastructure context, read
[`vps_deployment_guide.md`](./vps_deployment_guide.md) first.

## Objectives

| Objective | Target  | Source                            |
| --------- | ------- | --------------------------------- |
| RTO       | 1 hour  | "time to a working app"           |
| RPO       | 15 min  | bounded by pgbackrest `archive_timeout=60` + B2 upload latency; in practice closer to 2 min |

If a drill or real incident takes longer than RTO, that's a
post-incident finding, not a failure — record it in the tracking table
at the bottom of this file.

## Who runs this

- Primary: whoever holds the `~/.ssh/id_onepercent` key (i.e. you).
- Secondary: nobody yet. Adding a second key-holder is a Wave 7 open
  item.

## Pre-flight (do this once, not during an incident)

- [ ] Confirm you can `ssh onepercent-prod "hostname"`.
- [ ] Confirm you have the B2 keyID + applicationKey and the
      `repo1-cipher-pass` in 1Password (or equivalent).
- [ ] Confirm you have the latest `/opt/onepercent/.env` cached
      locally (encrypted) — without it, `docker compose` won't render
      the password substitutions.

## Scenario A — Lost VPS

The Linode is gone (host failure, accidental deletion, region outage).
You need a new VPS, restored DB, and DNS swapped.

### Steps

1. **Provision a new Linode**
   - Plan: same as current (Dedicated 16 GB).
   - Region: preferably the same; switch only if the original region is
     down.
   - Image: Ubuntu 24.04 LTS.
   - Root SSH key: the same `~/.ssh/id_onepercent.pub` you use today.
   - Note the new IPv4 address.

   ```bash
   # From your laptop, once Linode reports "Running"
   ssh root@<NEW_IP> "hostname && uname -a"
   ```

2. **Bootstrap the host**

   ```bash
   # Re-point the ssh alias temporarily
   ssh -o StrictHostKeyChecking=accept-new root@<NEW_IP>

   # Pull the repo onto the new box
   ssh root@<NEW_IP> "
     apt-get update && apt-get install -y git rsync curl
     git clone https://github.com/<OWNER>/OnePercentRealEstate /opt/onepercent
     cd /opt/onepercent
     bash infrastructure/setup_server.sh
   "
   ```

3. **Restore `.env`**

   ```bash
   scp ~/secure/onepercent.env root@<NEW_IP>:/opt/onepercent/.env
   ssh root@<NEW_IP> "chmod 600 /opt/onepercent/.env && chown root:root /opt/onepercent/.env"
   ```

4. **Install pgbackrest and the secret overlay**

   Follow steps 4–5 of `setup-pgbackrest.md`. Don't run
   `stanza-create` — the stanza already exists in B2.

5. **Bring up Postgres _only_ (empty data dir)**

   ```bash
   ssh root@<NEW_IP> "
     cd /opt/onepercent
     set -a && . ./.env && set +a
     # Start postgres so the data dir exists, then stop it cleanly
     docker compose -f infrastructure/docker-compose.yml up -d postgres
     sleep 10
     docker compose -f infrastructure/docker-compose.yml stop postgres
   "
   ```

6. **Restore from the latest backup**

   ```bash
   ssh root@<NEW_IP> "
     # Wipe the auto-initialized data dir; pgbackrest restore writes here
     rm -rf /var/lib/postgresql/data/*
     sudo -u postgres pgbackrest --stanza=oper --delta restore
   "
   ```

   For PITR to a specific moment (e.g. immediately before a destructive
   migration), see Scenario C.

7. **Start Postgres and let WAL replay finish**

   ```bash
   ssh root@<NEW_IP> "
     docker compose -f /opt/onepercent/infrastructure/docker-compose.yml start postgres
     # Tail logs until you see 'database system is ready to accept connections'
     docker logs -f infrastructure-postgres-1
   "
   ```

8. **Smoke test the data**

   ```bash
   ssh root@<NEW_IP> "
     docker exec infrastructure-postgres-1 psql -U postgres -c \
       'SELECT count(*) FROM listings; SELECT max(updated_at) FROM listings;'
   "
   ```

   Compare against your last known prod numbers. Within RPO drift is
   expected.

9. **Bring up the rest of the stack**

   ```bash
   ssh root@<NEW_IP> "
     cd /opt/onepercent
     set -a && . ./.env && set +a
     docker compose -f infrastructure/docker-compose.yml up -d
     docker compose -f infrastructure/docker-compose.yml ps
   "
   ```

10. **Restore nginx and TLS**

    ```bash
    # nginx config snippets are in the repo
    ssh root@<NEW_IP> "
      cp -r /opt/onepercent/infrastructure/nginx/sites-available/* /etc/nginx/sites-available/
      ln -sf /etc/nginx/sites-available/one.octavo.press.conf /etc/nginx/sites-enabled/
      ln -sf /etc/nginx/sites-available/two.octavo.press.conf /etc/nginx/sites-enabled/ 2>/dev/null || true

      # Re-issue certs (DNS must point here first — see step 11)
      certbot --nginx -d one.octavo.press --non-interactive --agree-tos -m ops@octavo.press
      certbot --nginx -d two.octavo.press --non-interactive --agree-tos -m ops@octavo.press 2>/dev/null || true
      nginx -t && systemctl reload nginx
    "
    ```

11. **Swap DNS**

    In your DNS provider (Cloudflare, Route 53, etc.):
    - `one.octavo.press` → A record → `<NEW_IP>`
    - `two.octavo.press` → A record → `<NEW_IP>`
    - TTL: drop to 60s during the cutover, raise back to 300s after.

12. **Verify end-to-end**

    ```bash
    curl -s https://one.octavo.press/api/healthz
    curl -s https://one.octavo.press/api/properties?limit=1 | head -c 200
    ```

13. **Update the ssh alias**

    Edit `~/.ssh/config` on your laptop, swap `Hostname` to `<NEW_IP>`.
    Then destroy the old Linode (if it's recoverable) to stop billing.

## Scenario B — Corrupted DB

Postgres is up but returning wrong/garbage data (e.g. a bad migration,
or filesystem corruption that didn't trip the healthcheck). You want
to roll back to a known-good moment.

### Steps

1. **Quiesce writes**

   ```bash
   ssh onepercent-prod "
     cd /opt/onepercent
     docker compose -f infrastructure/docker-compose.yml stop app scraper n8n
   "
   ```

2. **Capture a forensic snapshot before restoring**

   The bad state may contain clues. Save it before overwriting:

   ```bash
   ssh onepercent-prod "
     docker exec infrastructure-postgres-1 pg_dump -U postgres -Fc postgres \
       > /opt/onepercent/backups/forensic-$(date +%Y%m%d-%H%M%S).dump
   "
   ```

3. **Stop Postgres**

   ```bash
   ssh onepercent-prod "
     cd /opt/onepercent
     docker compose -f infrastructure/docker-compose.yml stop postgres
   "
   ```

4. **Pick a recovery target time**

   Find the timestamp just before the corruption. Use UTC.
   Examples: `2026-06-02 14:23:00 UTC`.

5. **Restore to that time**

   ```bash
   ssh onepercent-prod "
     rm -rf /var/lib/postgresql/data/*
     sudo -u postgres pgbackrest --stanza=oper --delta \
       --type=time '--target=2026-06-02 14:23:00 UTC' \
       --target-action=promote restore
   "
   ```

6. **Start Postgres**

   ```bash
   ssh onepercent-prod "
     cd /opt/onepercent
     docker compose -f infrastructure/docker-compose.yml start postgres
     sleep 15
     docker exec infrastructure-postgres-1 psql -U postgres -c 'SELECT now(), pg_is_in_recovery();'
   "
   ```

   `pg_is_in_recovery()` should return `f`.

7. **Smoke test**

   Same query as scenario A step 8.

8. **Restart the app stack**

   ```bash
   ssh onepercent-prod "
     cd /opt/onepercent
     set -a && . ./.env && set +a
     docker compose -f infrastructure/docker-compose.yml up -d app scraper n8n
   "
   ```

## Scenario C — Accidental `DROP TABLE`

Someone (you) ran a destructive query in psql. The table is gone but
the DB is otherwise healthy. Same flow as Scenario B, but with a tight
PITR target.

### Steps

1. **Stop writes immediately**

   Every second of write traffic since the DROP makes the rollback
   uglier (since we'll lose those writes too).

   ```bash
   ssh onepercent-prod "
     cd /opt/onepercent
     docker compose -f infrastructure/docker-compose.yml stop app scraper n8n
   "
   ```

2. **Identify the moment of the DROP**

   ```bash
   # Postgres logs are inside the container; the docker logs JSON
   # driver keeps them rotated.
   ssh onepercent-prod "docker logs infrastructure-postgres-1 2>&1 | grep -i 'drop table' | tail"
   ```

   Note the timestamp. Subtract 30 seconds to be safe.

3. **Save a forensic dump**

   Same as Scenario B step 2.

4. **Stop Postgres, restore, start**

   Same as Scenario B steps 3–6, with
   `--target='<DROP_TIME_MINUS_30S> UTC'`.

5. **Reconcile**

   If writes between `<DROP_TIME - 30s>` and "now" were important, you
   have to choose: live with the data loss, or hand-merge from the
   forensic dump captured in step 3. There is no shortcut.

6. **Re-launch the app stack**

   Same as Scenario B step 8.

## Quarterly drill checklist

Run this once a quarter. Use a fresh Linode (smallest plan,
~$5/mo for an hour). Record results in the table below.

- [ ] Spin up a Nanode 1 GB Linode in any region
- [ ] `ssh-copy-id` the deploy key
- [ ] Run `apt-get update && apt-get install -y git rsync curl pgbackrest`
- [ ] Install Docker (`curl -fsSL https://get.docker.com | sh`)
- [ ] Clone the repo to `/opt/onepercent`
- [ ] Copy `/etc/pgbackrest/` from prod (config + secret overlay)
- [ ] Run `pgbackrest --stanza=oper --delta restore`
- [ ] Bring up Postgres only
- [ ] Smoke query: `SELECT count(*) FROM listings`
- [ ] Compare against prod (`ssh onepercent-prod "docker exec infrastructure-postgres-1 psql -U postgres -c 'SELECT count(*) FROM listings'"`)
- [ ] Record actual RTO (start → smoke-query-passes) and RPO (now − latest restored timestamp)
- [ ] `linode-cli linodes delete <ID>` to destroy
- [ ] File the row below

## Drill history

| Date       | Operator | RTO actual | RPO actual | Backup size | Notes                                                                |
| ---------- | -------- | ---------- | ---------- | ----------- | -------------------------------------------------------------------- |
| 2026-09-01 |          |            |            |             | (target date — first drill after pgbackrest goes live)               |
|            |          |            |            |             |                                                                      |
|            |          |            |            |             |                                                                      |
|            |          |            |            |             |                                                                      |

## Known gaps

- The runbook assumes `postgres` is the only stateful service that
  matters. `n8n_data` (workflow definitions) and `redis_data` (rate
  limit counters, cache) are not backed up. Acceptable for now:
  workflows are version-controlled in `infrastructure/n8n_workflow_*.json`,
  redis is a cache. Revisit when the n8n workflow set grows beyond
  what we can re-import in 10 minutes.
- No automated DR verification yet. The quarterly drill is the only
  guarantee that a backup is actually restorable.
- The forensic dump (Scenario B step 2) requires the DB to still be
  up enough for `pg_dump` to run. If Postgres won't start at all,
  skip it.
