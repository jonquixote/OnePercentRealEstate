# Setting up pgbackrest for OnePercentRealEstate

This walks through installing and wiring `pgbackrest` against the live
Linode VPS. It is **not** automated — run it once, by hand, after you
have a Backblaze B2 bucket and an application key.

For overall context, read
[`documentation/operations/vps_deployment_guide.md`](../../documentation/operations/vps_deployment_guide.md)
first.

## Design choice: pgbackrest on the host, not in the container

We run `pgbackrest` as a host package (`apt install pgbackrest`) rather
than baking it into the Postgres image. The trade-offs:

| Option                  | Pros                                                        | Cons                                                                |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Host package (chosen)   | Independent of image rebuilds; easy `apt upgrade`; systemd timers natural | Must access the data dir from the host (bind mount or `_data` path) |
| Inside Postgres image   | Same fs view as Postgres; no mount juggling                 | Couples backup tooling to image build; harder to upgrade pgbackrest |
| Sidecar container       | Decoupled from Postgres image; shares the named volume      | More moving parts; archive_command needs to reach into the sidecar  |

The host option is the simplest path to a working RPO/RTO. We accept
that the Postgres container must expose its data dir as a bind mount
(see step 3 below).

## Prerequisites

- SSH access to `onepercent-prod` as root.
- A Backblaze account (free tier is fine for the first few GB).
- Roughly 10 minutes of downtime for the Postgres container (restart
  after the bind-mount change).

## 1. Create the B2 bucket and application key

In the Backblaze web console:

1. **Create bucket**
   - Name: `octavo-pg-backups`
   - Files in bucket: **Private**
   - Default encryption: **Disable** (pgbackrest does its own AES-256)
   - Object Lock: **Disable** (can enable later for ransomware
     hardening; needs careful integration with retention)
   - Region: note it. The defaults in `pgbackrest.conf` assume
     `us-west-002`. If yours is `us-east-005`, update
     `repo1-s3-region` and `repo1-s3-endpoint` accordingly.

2. **Create application key**
   - Name: `pgbackrest-oper`
   - Allow access to: **only** `octavo-pg-backups`
   - Capabilities: `listBuckets`, `listFiles`, `readFiles`, `writeFiles`,
     `deleteFiles`
   - Duration: leave blank (no expiry)
   - Save the `keyID` and `applicationKey` immediately — Backblaze only
     shows them once.

## 2. Generate the cipher passphrase

On your laptop (not the server):

```bash
openssl rand -base64 48
```

Save this output. It's the `repo1-cipher-pass`. Losing it means losing
the ability to restore. Store it in 1Password (or equivalent) alongside
the B2 key.

## 3. Adjust docker-compose.yml to bind-mount the data dir

Edit `infrastructure/docker-compose.yml`, replace the `postgres_data`
named-volume entry under the `postgres` service with a bind mount:

```yaml
  postgres:
    # ...
    volumes:
      # was: - postgres_data:/var/lib/postgresql/data
      - /var/lib/postgresql/data:/var/lib/postgresql/data
      - ../init-scripts:/docker-entrypoint-initdb.d
```

Then remove the `postgres_data:` entry from the bottom-of-file
`volumes:` block (n8n_data and redis_data stay).

**Before applying**, migrate the existing data:

```bash
ssh onepercent-prod "docker compose -f /opt/onepercent/infrastructure/docker-compose.yml stop postgres"
ssh onepercent-prod "mkdir -p /var/lib/postgresql && \
  rsync -aHAX /var/lib/docker/volumes/infrastructure_postgres_data/_data/ \
    /var/lib/postgresql/data/"
ssh onepercent-prod "chown -R 70:70 /var/lib/postgresql/data"  # alpine postgres uid:gid
# Then rsync the updated docker-compose.yml and bring postgres back up.
```

If you'd rather keep the named volume, set `pg1-path` in
`pgbackrest.conf` to
`/var/lib/docker/volumes/infrastructure_postgres_data/_data` and skip
this step. The trade-off is that `docker volume rm` becomes a footgun.

## 4. Install pgbackrest on the host

```bash
ssh onepercent-prod "apt-get update && apt-get install -y pgbackrest"
ssh onepercent-prod "pgbackrest version"   # expect 2.x
```

Create the directories pgbackrest needs:

```bash
ssh onepercent-prod "
  mkdir -p /etc/pgbackrest /etc/pgbackrest/conf.d \
           /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest
  chown -R postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest
  chmod 750 /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest
"
```

## 5. Copy the config files into place

```bash
# Main config (safe to copy as-is)
scp infrastructure/backup/pgbackrest.conf onepercent-prod:/etc/pgbackrest/pgbackrest.conf

# Secret overlay (you build this locally; DO NOT commit it)
cat > /tmp/pgbackrest.conf.local <<'EOF'
[global]
repo1-s3-key=<B2 keyID from step 1>
repo1-s3-key-secret=<B2 applicationKey from step 1>
repo1-cipher-pass=<openssl output from step 2>
EOF

scp /tmp/pgbackrest.conf.local onepercent-prod:/etc/pgbackrest/conf.d/pgbackrest.conf.local
rm /tmp/pgbackrest.conf.local   # remove from laptop

ssh onepercent-prod "
  chown root:postgres /etc/pgbackrest/pgbackrest.conf \
                      /etc/pgbackrest/conf.d/pgbackrest.conf.local
  chmod 640 /etc/pgbackrest/pgbackrest.conf
  chmod 640 /etc/pgbackrest/conf.d/pgbackrest.conf.local
"
```

## 6. Configure Postgres to archive WAL

Append to `postgresql.conf` inside the container. Since the container's
config dir is the data dir, you can edit it from the host once the
bind-mount is in place:

```bash
ssh onepercent-prod "cat >> /var/lib/postgresql/data/postgresql.conf <<'EOF'

# pgbackrest WAL archiving
archive_mode = on
archive_command = 'pgbackrest --stanza=oper archive-push %p'
archive_timeout = 60
max_wal_senders = 3
wal_level = replica
EOF"
```

Reload (a full restart is required for `archive_mode` and `wal_level`):

```bash
ssh onepercent-prod "docker compose -f /opt/onepercent/infrastructure/docker-compose.yml restart postgres"

# Confirm
ssh onepercent-prod "docker exec infrastructure-postgres-1 \
  psql -U postgres -c 'SHOW archive_mode; SHOW archive_command;'"
```

If you see `archive_command` running every minute in the Postgres log
and `/var/spool/pgbackrest` accumulates files briefly before draining,
archiving is working.

## 7. Create the stanza and the first full backup

```bash
ssh onepercent-prod "sudo -u postgres pgbackrest --stanza=oper stanza-create"
ssh onepercent-prod "sudo -u postgres pgbackrest --stanza=oper check"
ssh onepercent-prod "sudo -u postgres pgbackrest --stanza=oper backup --type=full"
```

The first full backup will be slow (network-bound to B2). Subsequent
incrementals are fast.

Verify in B2: the bucket should now contain `/pgbackrest/backup/oper/`
and `/pgbackrest/archive/oper/`.

## 8. Schedule via systemd timers

Two units: a weekly full (Sundays 03:00 UTC) and a daily diff
(02:00 UTC). Install both on the server.

### `/etc/systemd/system/pgbackrest-full.service`

```ini
[Unit]
Description=pgbackrest full backup (oper stanza)
After=docker.service

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pgbackrest --stanza=oper --type=full backup
```

### `/etc/systemd/system/pgbackrest-full.timer`

```ini
[Unit]
Description=Weekly full pgbackrest backup

[Timer]
OnCalendar=Sun *-*-* 03:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

### `/etc/systemd/system/pgbackrest-diff.service`

```ini
[Unit]
Description=pgbackrest diff backup (oper stanza)
After=docker.service

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/bin/pgbackrest --stanza=oper --type=diff backup
```

### `/etc/systemd/system/pgbackrest-diff.timer`

```ini
[Unit]
Description=Daily differential pgbackrest backup

[Timer]
OnCalendar=*-*-* 02:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
ssh onepercent-prod "
  systemctl daemon-reload
  systemctl enable --now pgbackrest-full.timer pgbackrest-diff.timer
  systemctl list-timers | grep pgbackrest
"
```

## 9. Verify

```bash
# Show backup info
ssh onepercent-prod "sudo -u postgres pgbackrest --stanza=oper info"

# Tail logs
ssh onepercent-prod "tail -n 50 /var/log/pgbackrest/oper-backup.log"
```

You should see at least one `full` backup and the WAL archive count
growing every minute (driven by `archive_timeout=60`).

## 10. Tear down the old `pg_dump` cron (if any)

The VPS guide's `pg_dump` snippet was manual, so there is likely no
cron entry to remove. If you added one earlier, comment it out — leave
a one-line tombstone so future-you doesn't wonder where the dumps went:

```cron
# pg_dump replaced by pgbackrest 2026-06-02; see infrastructure/backup/
```

## Next steps

- Add the DR runbook to your quarterly calendar:
  [`documentation/operations/dr-runbook.md`](../../documentation/operations/dr-runbook.md).
- Wire pgbackrest health into Prometheus (the
  `pgbackrest --stanza=oper info --output=json` command is parseable;
  a textfile collector cron is the easiest path). Out of scope for
  this wave.
