# Backup & Restore — Postgres + Redis

## Overview

The app holds two critical pieces of state: **Postgres** (1.2M+ listings) and **Redis** (cache + idempotency). Both are backed up nightly to Backblaze B2 ($5/TB/mo, $0.01/GB egress).

**Backups are NOT enabled by default.** This document is the runbook for when you decide to turn them on.

## Backblaze B2 Setup (One-Time)

1. Create Backblaze account: https://www.backblaze.com/b2
2. Create a bucket: `onepercent-prod-backups` (private, all regions)
3. Create an application key with read+write to that bucket only
4. Save to your password manager:
   - `B2_KEY_ID`
   - `B2_APPLICATION_KEY`
   - `B2_BUCKET=onepercent-prod-backups`

## Server-Side Setup (One-Time)

```bash
# Install rclone (handles B2 + S3 + any cloud)
ssh root@onepercent-prod
curl https://rclone.org/install.sh | sudo bash
mkdir -p /root/.config/rclone

# Configure B2
rclone config
# → n) New remote
# → name> b2
# → Storage> b2
# → account> <B2_KEY_ID>
# → key> <B2_APPLICATION_KEY>
# → y) yes to auto config

# Test
rclone lsd b2:
```

## Postgres Backup Script

Create `/opt/onepercent/scripts/backup-postgres.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR=/var/backups/postgres
KEEP_LOCAL=3
PROJECT_DIR=/opt/onepercent
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
B2_PATH="b2:onepercent-prod-backups/postgres/${TIMESTAMP}"

mkdir -p "$BACKUP_DIR"
cd "$PROJECT_DIR"

POSTGRES_PASSWORD=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)

echo "[$(date)] Starting Postgres backup..."

docker compose -f infrastructure/docker-compose.yml exec -T postgres \
  pg_dump -U postgres -d postgres --format=custom --no-owner --no-acl \
  > "$BACKUP_DIR/listings-${TIMESTAMP}.dump"

echo "[$(date)] Compressing..."
gzip "$BACKUP_DIR/listings-${TIMESTAMP}.dump"

echo "[$(date)] Uploading to B2..."
rclone copy "$BACKUP_DIR/listings-${TIMESTAMP}.dump.gz" "$B2_PATH" \
  --transfers=4 --checkers=8 --progress

echo "[$(date)] Pruning local backups (keeping last $KEEP_LOCAL)..."
ls -1t "$BACKUP_DIR"/listings-*.dump.gz | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm

echo "[$(date)] Done. Remote: $B2_PATH"
```

```bash
chmod +x /opt/onepercent/scripts/backup-postgres.sh
```

## Schedule via Cron

```bash
# Run nightly at 3 AM UTC
crontab -e
# Add:
0 3 * * * /opt/onepercent/scripts/backup-postgres.sh >> /var/log/onepercent-backup.log 2>&1
```

## Redis Backup (Optional)

Redis is mostly cache. Only backup the AOF file for warm-restore speed:

```bash
# In docker-compose.yml, Redis is configured with --appendonly yes
# Local AOF is at /var/lib/docker/volumes/onepercent_redis_data/_data/appendonly.aof

# Add to backup script:
rclone copy /var/lib/docker/volumes/onepercent_redis_data/_data/appendonly.aof \
  b2:onepercent-prod-backups/redis/${TIMESTAMP}/
```

## Restore — Postgres

```bash
# 1. Find the backup to restore
rclone lsf b2:onepercent-prod-backups/postgres/ --dirs-only | sort -r | head

# 2. Download it
mkdir -p /tmp/restore
rclone copy "b2:onepercent-prod-backups/postgres/20260601T030000Z/" /tmp/restore/

# 3. Stop the app (so it doesn't write to DB during restore)
cd /opt/onepercent
docker compose -f infrastructure/docker-compose.yml stop app n8n scraper

# 4. Drop and recreate the database
docker compose -f infrastructure/docker-compose.yml exec postgres \
  dropdb -U postgres listings --if-exists
docker compose -f infrastructure/docker-compose.yml exec postgres \
  createdb -U postgres listings

# 5. Restore
gunzip -c /tmp/restore/listings-20260601T030000Z.dump.gz | \
  docker compose -f infrastructure/docker-compose.yml exec -T postgres \
  pg_restore -U postgres -d listings --no-owner --no-acl --jobs=4

# 6. Restart everything
docker compose -f infrastructure/docker-compose.yml up -d
```

## Restore — Point-in-Time (WAL Archiving)

For true PITR (point-in-time recovery) you need WAL archiving. To enable:

1. Add to Postgres config (via docker-compose environment):
   ```yaml
   command:
     - "postgres"
     - "-c"
     - "wal_level=replica"
     - "-c"
     - "archive_mode=on"
     - "-c"
     - "archive_command='rclone cat b2:onepercent-prod-backups/wal/%f'"
   ```

2. Schedule `base backup` weekly:
   ```bash
   docker compose exec postgres pg_basebackup -D /tmp/basebackup -Ft -z -P
   rclone copy /tmp/basebackup b2:onepercent-prod-backups/base/
   ```

3. To restore to a specific time, use `pg_restore --target-time`.

PITR is a much bigger lift; recommend starting with nightly `pg_dump` first.

## Verifying Backups

Add a weekly verification (different cron job):

```bash
# Pick the most recent backup, restore to a temporary database, count rows
LATEST=$(rclone lsf b2:onepercent-prod-backups/postgres/ --files-only --format=p | tail -1)
rclone cat "b2:onepercent-prod-backups/postgres/$LATEST" | gunzip | \
  pg_restore -d postgres://localhost/test_restore --no-owner --no-acl
psql -d test_restore -c "SELECT COUNT(*) FROM listings;"
dropdb test_restore
```

If `COUNT(*)` matches expectations, backup integrity is good.

## Recovery Time Objective (RTO)

| Scenario | Time |
|---|---|
| Server lost, restore to new Linode | 30-60 min |
| DB corrupted, restore from nightly backup | 10-30 min |
| Single row lost, manual re-scrape | 5-15 min |

## Recovery Point Objective (RPO)

| Configuration | RPO |
|---|---|
| Nightly `pg_dump` (default) | up to 24 hours of data |
| WAL archiving enabled | < 5 minutes |
| Managed Postgres (DigitalOcean, etc.) | < 1 minute (provider's SLA) |

## Cost

- 100 GB of compressed pg_dumps: ~$0.50/mo in B2
- Egress for restore: ~$1 per restore event
- Negligible for this workload
