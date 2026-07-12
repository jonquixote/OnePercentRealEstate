#!/usr/bin/env bash
# S2 (backend-db-hardening): rotate rent_predictions_audit partitions.
#
# - Creates the current + next 3 months' partitions (so live writes never land
#   in the DEFAULT backstop).
# - For every monthly partition whose entire month is older than the 90-day
#   retention window: compress it to /var/backups/oper/audit/<part>.dump.gz,
#   copy that to R2 (oper-r2:onepercent-pg-backups/audit/), then DROP the
#   partition. A partition is only dropped after a successful R2 copy — if the
#   copy fails, the data stays (alert, no drop).
#
# Runs from oper-audit-rotate.{service,timer} as root; psql/pg_dump use peer
# auth via sudo -u postgres.
set -uo pipefail

PG="sudo -u postgres psql -v ON_ERROR_STOP=1 -t -A -X -d postgres"
AUDIT=rent_predictions_audit
ARCHIVE_DIR=/var/backups/oper/audit
R2="oper-r2:onepercent-pg-backups/audit"
RETENTION_DAYS=90

mkdir -p "$ARCHIVE_DIR"

# 1) ensure current + next 3 months exist (idempotent).
for i in 0 1 2 3; do
  m=$(date -u -d "+${i} month" +%Y-%m-01)
  pname="${AUDIT}_p$(date -u -d "+${i} month" +%Y_%m)"
  if [ -z "$($PG -c "SELECT 1 FROM pg_class WHERE relname='$pname'" 2>/dev/null)" ]; then
    to=$(date -u -d "$m +1 month" +%Y-%m-01)
    echo "creating partition $pname [$m -> $to]"
    $PG -c "CREATE TABLE IF NOT EXISTS $pname PARTITION OF $AUDIT FOR VALUES FROM ('$m') TO ('$to')"
  fi
done

# 2) archive + drop months fully older than retention.
now_minus_ret=$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d)

for pname in $($PG -c "SELECT inhrelid::regclass::text FROM pg_inherits WHERE inhparent='$AUDIT'::regclass" 2>/dev/null | grep -E "_p[0-9]{4}_[0-9]{2}$"); do
  ym=${pname#"${AUDIT}_p"}
  y=${ym:0:4}; mo=${ym:5:2}
  month_end=$(date -u -d "${y}-${mo}-01 +1 month" +%Y-%m-%d)
  if [[ "$month_end" < "$now_minus_ret" ]]; then
    dump="$ARCHIVE_DIR/${pname}.dump.gz"
    echo "archiving $pname (month_end $month_end) -> $dump"
    if sudo -u postgres pg_dump -t "$pname" postgres | gzip > "$dump"; then
      if rclone copy "$dump" "$R2/"; then
        echo "R2 copy ok; dropping $pname"
        $PG -c "DROP TABLE $pname"
      else
        echo "ERROR: rclone copy failed for $pname — NOT dropping (data preserved)" >&2
      fi
    else
      echo "ERROR: pg_dump failed for $pname — NOT dropping" >&2
    fi
  fi
done

echo "audit-rotate done"
