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

# ---------------------------------------------------------------------------
# OFF-BOX assertion.
#
# This drill used to verify ONLY the local dump — which proves nothing about
# the copy that exists to survive losing the box. On 2026-07-31 the server was
# shut down on an expired account and became unrecoverable; the local dumps
# went with it, and nothing had ever confirmed the R2 copy was present, recent
# or sized like a real dump. Verify the thing that has to survive.
# ---------------------------------------------------------------------------
R2_REMOTE="${R2_REMOTE:-oper-r2:onepercent-pg-backups}"
R2_MAX_AGE_H="${R2_MAX_AGE_H:-30}"     # a daily backup older than this is stale
R2_MIN_MB="${R2_MIN_MB:-200}"          # a "dump" far under this is not a dump

if ! command -v rclone >/dev/null 2>&1; then
  echo "FAIL: rclone not installed — there is no off-box backup" >&2
  exit 4
fi
if ! rclone lsd "$R2_REMOTE" >/dev/null 2>&1; then
  echo "FAIL: R2 remote '$R2_REMOTE' unreachable — off-box backup unverified" >&2
  exit 5
fi

# Newest object: modtime + size, whitespace-separated.
read -r R2_AGE_H R2_MB <<<"$(rclone lsjson "$R2_REMOTE" --files-only 2>/dev/null | python3 -c '
import json,sys,datetime
try: objs = json.load(sys.stdin)
except Exception: objs = []
if not objs:
    print("99999 0"); sys.exit()
newest = max(objs, key=lambda o: o["ModTime"])
mt = datetime.datetime.fromisoformat(newest["ModTime"].replace("Z","+00:00"))
age_h = (datetime.datetime.now(datetime.timezone.utc) - mt).total_seconds()/3600
size_mb = newest["Size"] / 1048576
# Compute size_mb ABOVE the f-string: nesting escaped double quotes inside an
# f-string inside a single-quoted shell -c is a syntax error, and it silently
# turned this whole assertion into "0 MB" -> a false FAIL on a healthy backup.
print("%.1f %.0f" % (age_h, size_mb))
')"

echo "  R2 newest: ${R2_MB} MB, ${R2_AGE_H} h old"
if [ "${R2_MB:-0}" -lt "$R2_MIN_MB" ]; then
  echo "FAIL: newest R2 object is ${R2_MB} MB (< ${R2_MIN_MB} MB) — not a real dump" >&2
  exit 6
fi
if awk "BEGIN{exit !(${R2_AGE_H:-99999} > $R2_MAX_AGE_H)}"; then
  echo "FAIL: newest R2 backup is ${R2_AGE_H} h old (> ${R2_MAX_AGE_H} h) — off-box copy is stale" >&2
  exit 7
fi

# Size budget: the bucket must stay small enough to keep, and a sync that
# stopped pruning is exactly how it reached 80+ GB against a 10 GB budget.
R2_TOTAL_GB="$(rclone size "$R2_REMOTE" --json 2>/dev/null | python3 -c 'import json,sys; print("%.1f" % (json.load(sys.stdin)["bytes"]/1073741824))' 2>/dev/null || echo 0)"
R2_BUDGET_GB="${R2_BUDGET_GB:-10}"
echo "  R2 total: ${R2_TOTAL_GB} GB (budget ${R2_BUDGET_GB} GB)"
if awk "BEGIN{exit !($R2_TOTAL_GB > $R2_BUDGET_GB)}"; then
  echo "FAIL: R2 bucket is ${R2_TOTAL_GB} GB, over the ${R2_BUDGET_GB} GB budget — retention is not pruning" >&2
  exit 8
fi

echo "off-box backup OK: ${R2_MB} MB, ${R2_AGE_H} h old, bucket ${R2_TOTAL_GB} GB"
