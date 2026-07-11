#!/usr/bin/env bash
# Restore drill for the nightly Postgres dump.
#
# Restores the most recent daily dump into a scratch database, counts rows in
# three representative tables, then drops the scratch db. Exits non-zero (and
# thus triggers the timer's OnFailure alert) if anything is missing or the
# dump cannot be restored.
set -euo pipefail

BACKUP_DIR="/var/backups/oper"
SCRATCH="oper_restore_drill"
TABLES=("listings" "parcels" "epa_walkability")

set +u
# shellcheck disable=SC2046
export $(grep -v '^#' /etc/oper.env | grep -v '^$' | xargs)
set -u

if [ -z "${PGPASSWORD:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  PGPASSWORD="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
  export PGPASSWORD
fi

LATEST="$(ls -t "$BACKUP_DIR"/postgres-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  echo "FAIL: no dump found in $BACKUP_DIR" >&2
  exit 2
fi
echo "Restore drill using: $LATEST"

dropdb --if-exists -h localhost -U postgres "$SCRATCH" >/dev/null 2>&1 || true
createdb -h localhost -U postgres "$SCRATCH"
pg_restore -Fc -h localhost -U postgres -d "$SCRATCH" "$LATEST" --no-owner --no-privileges

for t in "${TABLES[@]}"; do
  n="$(psql -h localhost -U postgres -d "$SCRATCH" -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo 'ERR')"
  echo "  $t: $n"
  if [ "$n" = "ERR" ] || [ "${n:-0}" -eq 0 ]; then
    echo "FAIL: table $t empty or missing in restore" >&2
    dropdb -h localhost -U postgres "$SCRATCH" >/dev/null 2>&1 || true
    exit 3
  fi
done

dropdb -h localhost -U postgres "$SCRATCH" >/dev/null 2>&1 || true
echo "restore drill OK: $LATEST"
