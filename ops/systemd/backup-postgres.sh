#!/usr/bin/env bash
# Nightly Postgres backup for the OnePercent oper stack.
#
# - pg_dump -Fc (compressed custom format) of the `postgres` database.
# - Local rotation: 3 daily + 4 weekly (Sunday snapshots) in /var/backups/oper.
# - Off-box MIRROR to Cloudflare R2 via rclone when configured (a backup that
#   lives only on the VPS is not a backup).
# - Refuses to run when free disk drops below a safety floor.
#
# R2 RETENTION — why this is a sync and not a copy:
#   This used `rclone copy`, which NEVER deletes at the destination. Local
#   rotation pruned the VPS, but every daily dump ever taken accumulated in R2
#   (plus weeklies, which were explicitly uploaded and never pruned there).
#   R2 reached 80+ GB against a 10 GB budget. `rclone sync` from a staging dir
#   holding exactly the newest dump makes R2 mirror that one file, so each run
#   removes what the previous run left.
#
#   TRADEOFF, stated plainly: R2_KEEP=1 means there is NO historical depth
#   off-box. Corruption discovered days later cannot be rolled back from R2 —
#   only from the local dailies, which live on the same box the off-box copy
#   exists to survive. Raise R2_KEEP to 2-3 if the size budget allows; the
#   dumps compress to a few GB each.
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
# How many dumps to retain OFF-BOX. 1 = only the newest (the size budget).
R2_KEEP="${R2_KEEP:-1}"
# pg_dump compression. zstd beats zlib substantially on this data and is
# supported by PG16's custom format; falls back to the default if unavailable.
DUMP_COMPRESS="${DUMP_COMPRESS:-zstd:9}"

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

echo "Dumping database '$PGDB' -> $DUMP (compress=$DUMP_COMPRESS)"
if ! pg_dump -Fc --compress="$DUMP_COMPRESS" -h localhost -U "$PGUSER" -d "$PGDB" -f "$DUMP" 2>/dev/null; then
  echo "WARN: --compress=$DUMP_COMPRESS rejected (method not built in?); using default compression" >&2
  pg_dump -Fc -h localhost -U "$PGUSER" -d "$PGDB" -f "$DUMP"
fi
echo "Dump complete: $(du -h "$DUMP" | cut -f1)"

# A zero-length or truncated dump must never overwrite a good off-box copy.
if [ ! -s "$DUMP" ]; then
  echo "FAIL: dump is empty; refusing to sync to R2" >&2
  exit 1
fi

# --- Encrypted config/secrets bundle ---------------------------------------
#
# The DB dump does NOT contain the box's secrets. Losing the old server on
# 2026-07-31 proved the cost: AUTH_SECRET, UNSUBSCRIBE_SECRET, ADMIN_API_KEY,
# every third-party API key and the Postgres/Redis passwords all had to be
# regenerated because they lived only in /opt/onepercent/.env. This bundles the
# un-git-tracked secrets alongside the dump so a full box loss is fully
# recoverable.
#
# ENCRYPTED WITH age, PUBLIC KEY ONLY on the box. The box can encrypt but CANNOT
# decrypt — the private key is held off-box by the operator. So a compromised
# box, or a leaked R2 bucket/token, still cannot read the secrets. If the public
# key is missing the whole backup FAILS rather than shipping plaintext secrets.
AGE_PUB_FILE="${AGE_PUB_FILE:-/etc/oper-backup-age.pub}"
CONFIG_BUNDLE="$BACKUP_DIR/config-$DATE.tar.age"
# Files that are secrets AND not in git. Everything else (unit files, nginx,
# postgres tuning) is versioned in the repo and rebuilt by install.sh.
CONFIG_SRC=(/opt/onepercent/.env /root/.r2creds /etc/oper-backup-age.pub)

if [ ! -s "$AGE_PUB_FILE" ]; then
  echo "FAIL: $AGE_PUB_FILE missing — refusing to back up secrets unencrypted" >&2
  exit 1
fi
if ! command -v age >/dev/null 2>&1; then
  echo "FAIL: age not installed — cannot encrypt the secrets bundle" >&2
  exit 1
fi

# tar only the sources that exist, pipe straight into age (plaintext never
# touches disk). Recipient = the public key; only the off-box private key opens it.
_existing=(); for f in "${CONFIG_SRC[@]}"; do [ -e "$f" ] && _existing+=("$f"); done
tar -czf - "${_existing[@]}" 2>/dev/null | age -r "$(cat "$AGE_PUB_FILE")" -o "$CONFIG_BUNDLE"
if [ ! -s "$CONFIG_BUNDLE" ]; then
  echo "FAIL: config bundle is empty; refusing to sync" >&2
  exit 1
fi
echo "Config bundle: $(du -h "$CONFIG_BUNDLE" | cut -f1) encrypted ($(printf '%s ' "${_existing[@]##*/}"))"
# Same local rotation as the dumps.
find "$BACKUP_DIR" -maxdepth 1 -name 'config-*.tar.age' -mtime +"$DAILY_KEEP" -delete

# Daily rotation.
find "$BACKUP_DIR" -maxdepth 1 -name 'postgres-*.dump' -mtime +"$DAILY_KEEP" -delete

# Weekly snapshot (Sunday) — retained long-term in R2; pruned locally after copy
# to avoid filling the VPS disk (DB + 7 daily dumps already consume most free space).
if [ "$WEEKDAY" = "7" ]; then
  cp -p "$DUMP" "$BACKUP_DIR/weekly-postgres-$DATE.dump"
fi
find "$BACKUP_DIR" -maxdepth 1 -name 'weekly-postgres-*.dump' -mtime +$((WEEKLY_KEEP * 7)) -delete

# Off-box MIRROR to R2 when rclone is configured.
#
# Staging dir holds exactly the dumps R2 should end up with (newest R2_KEEP).
# `rclone sync --delete-after` then makes the bucket match it: the new dump is
# uploaded FIRST and the stale objects are removed only after that succeeds, so
# a failed transfer can never leave the bucket empty.
if command -v rclone >/dev/null 2>&1; then
  if rclone lsd "$R2_REMOTE" >/dev/null 2>&1; then
    STAGE="$BACKUP_DIR/.r2-stage"
    rm -rf "$STAGE"; mkdir -p "$STAGE"
    # Stage the newest R2_KEEP of BOTH the DB dump and the encrypted config
    # bundle. The bucket ends up holding exactly these files, so the newest of
    # each is present and older ones are pruned — and because rclone sync
    # --delete-after uploads before deleting, the current pair can never be the
    # thing that gets removed ("does not delete itself").
    # Hardlink (same filesystem) so staging costs no extra disk; copy if not.
    for pat in 'postgres-*.dump' 'config-*.tar.age'; do
      for f in $(ls -t "$BACKUP_DIR"/$pat 2>/dev/null | head -n "$R2_KEEP"); do
        ln "$f" "$STAGE/$(basename "$f")" 2>/dev/null || cp -p "$f" "$STAGE/"
      done
    done

    echo "Mirroring newest $R2_KEEP dump(s) + config bundle(s) to R2 ($R2_REMOTE)"
    rclone sync "$STAGE" "$R2_REMOTE" \
      --delete-after --low-level-retries 3 --retries 5
    rm -rf "$STAGE"

    echo "R2 now holds: $(rclone size "$R2_REMOTE" 2>/dev/null | tr '\n' ' ')"
    # Weekly snapshots are local-only now — R2 is size-capped and mirrors the
    # newest dump. Prune the local weekly copy to save VPS disk.
    rm -f "$BACKUP_DIR"/weekly-postgres-*.dump
  else
    echo "WARN: rclone remote '$R2_REMOTE' not reachable/configured; local-only backup" >&2
  fi
else
  echo "WARN: rclone not installed; local-only backup (off-box copy pending)" >&2
fi

echo "backup done: $DUMP"
