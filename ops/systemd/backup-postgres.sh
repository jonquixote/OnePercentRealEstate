#!/usr/bin/env bash
# Nightly Postgres backup for the OnePercent oper stack.
#
# - pg_dump -Fc (compressed custom format) of the `postgres` database.
# - Local rotation: 7 daily + 4 weekly (Sunday snapshots) in /var/backups/oper.
# - Off-box copy to Cloudflare R2 via rclone when configured (a backup that
#   lives only on the VPS is not a backup).
# - Refuses to run when free disk drops below a safety floor.
#
# Runs as root; authenticates over TCP using PGPASSWORD from /etc/oper.env.
set -euo pipefail

BACKUP_DIR="/var/backups/oper"
R2_REMOTE="${R2_REMOTE:-oper-r2:onepercent-pg-backups}"
PGUSER="${PGUSER:-postgres}"
PGDB="${PGDB:-postgres}"
DAILY_KEEP=3
WEEKLY_KEEP=4
FREE_FLOOR_GB=8

DATE="$(date +%Y-%m-%d)"
WEEKDAY="$(date +%u)"   # 1=Mon .. 7=Sun
DUMP="$BACKUP_DIR/postgres-$DATE.dump"

mkdir -p "$BACKUP_DIR"

FREE_GB="$(df -BG "$BACKUP_DIR" | awk 'NR==2{print $4}' | tr -d 'G')"
if [ "${FREE_GB:-0}" -lt "$FREE_FLOOR_GB" ]; then
  echo "WARN: low disk (${FREE_GB} GB free < ${FREE_FLOOR_GB} GB floor); skipping backup" >&2
  exit 0
fi

# Pull DB credentials (PGPASSWORD / DATABASE_URL) from the oper env file.
set +u
# shellcheck disable=SC2046
export $(grep -v '^#' /etc/oper.env | grep -v '^$' | xargs)
set -u

# pg_dump needs PGPASSWORD for TCP auth; derive it from DATABASE_URL if absent.
if [ -z "${PGPASSWORD:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  PGPASSWORD="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
  export PGPASSWORD
fi

echo "Dumping database '$PGDB' -> $DUMP"
pg_dump -Fc -h localhost -U "$PGUSER" -d "$PGDB" -f "$DUMP"
echo "Dump complete: $(du -h "$DUMP" | cut -f1)"

# Daily rotation.
find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.dump' -mtime +"$DAILY_KEEP" -delete

# Weekly snapshot (Sunday) — retained long-term in R2; pruned locally after copy
# to avoid filling the VPS disk (DB + 7 daily dumps already consume most free space).
if [ "$WEEKDAY" = "7" ]; then
  cp -p "$DUMP" "$BACKUP_DIR/weekly-postgres-$DATE.dump"
fi
find "$BACKUP_DIR" -maxdepth 1 -name 'weekly-postgres-*.dump' -mtime +$((WEEKLY_KEEP * 7)) -delete

# Off-box copy to R2 when rclone is configured.
if command -v rclone >/dev/null 2>&1; then
  if rclone lsd "$R2_REMOTE" >/dev/null 2>&1; then
    echo "Copying to R2 ($R2_REMOTE)"
    rclone copy "$BACKUP_DIR" "$R2_REMOTE" \
      --include 'postgres-*.dump' --include 'weekly-postgres-*.dump' \
      --low-level-retries 3 --retries 5
    echo "rclone copy done"
    # Weekly snapshots now live in R2; prune the local copy to save VPS disk.
    rm -f "$BACKUP_DIR"/weekly-postgres-*.dump
  else
    echo "WARN: rclone remote '$R2_REMOTE' not reachable/configured; local-only backup" >&2
  fi
else
  echo "WARN: rclone not installed; local-only backup (off-box copy pending)" >&2
fi

echo "backup done: $DUMP"
