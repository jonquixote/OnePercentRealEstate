#!/usr/bin/env bash
# Daily UpCloud snapshot + retention prune.
# Creates a snapshot of the prod boot disk, then prunes old oper-auto-* backups
# keeping at least 3 newest. Alerts on failure.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)

PROD_SERVER_UUID="${PROD_SERVER_UUID:-003b1626}"
RETENTION_DAYS=30
RETENTION_MIN=3

# Find the boot disk of the prod server
BOOT_DISK=$(upctl server storage list "$PROD_SERVER_UUID" --output json 2>/dev/null | \
  jq -r '[.[] | select(.type=="disk")] | sort_by(.created_at) | last | .uuid' 2>/dev/null || echo "")

if [[ -z "$BOOT_DISK" ]]; then
  "$NOTIFY" --key "snapshot" "RED ${BOX}: snapshot - failed to discover boot disk for server ${PROD_SERVER_UUID}"
  exit 1
fi

# Create snapshot
TITLE="oper-auto-$(date +%F)"
if ! upctl storage backup create "$BOOT_DISK" --description "$TITLE" >/dev/null 2>&1; then
  "$NOTIFY" --key "snapshot" "RED ${BOX}: snapshot - failed to create snapshot ${TITLE}"
  exit 1
fi
echo "Created snapshot: ${TITLE} (disk: ${BOOT_DISK})"

# Prune old snapshots (keep >=3 newest, remove those older than RETENTION_DAYS)
BACKUPS=$(upctl server storage list "$PROD_SERVER_UUID" --output json 2>/dev/null | \
  jq -r '[.[] | select(.description | startswith("oper-auto-"))] | sort_by(.created_at) | reverse' 2>/dev/null)

if [[ -z "$BACKUPS" || -z "$(echo "$BACKUPS" | jq -r 'length' 2>/dev/null)" ]]; then
  "$NOTIFY" --key "snapshot-prune" "RED ${BOX}: snapshot - failed to list backups for pruning"
  exit 1
fi

COUNT=$(echo "$BACKUPS" | jq 'length')
if [[ $COUNT -gt $RETENTION_MIN ]]; then
  CUTOFF=$(date -v-${RETENTION_DAYS}d +%s 2>/dev/null || date -d "-${RETENTION_DAYS} days" +%s 2>/dev/null || echo 0)

  echo "$BACKUPS" | jq -c ".[$RETENTION_MIN:][]" 2>/dev/null | while read -r backup; do
    CREATED=$(echo "$backup" | jq -r '.created_at')
    UUID=$(echo "$backup" | jq -r '.uuid')
    DESC=$(echo "$backup" | jq -r '.description')

    BACKUP_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${CREATED%%.*}" +%s 2>/dev/null \
      || date -d "${CREATED%%.*}" +%s 2>/dev/null \
      || echo 0)

    if [[ $BACKUP_EPOCH -lt $CUTOFF && $BACKUP_EPOCH -gt 0 ]]; then
      echo "Pruning old snapshot: ${DESC} (${UUID}, created ${CREATED})"
      if ! upctl storage delete "$UUID" --delete-backups >/dev/null 2>&1; then
        "$NOTIFY" --key "snapshot-prune" "RED ${BOX}: snapshot - failed to prune ${DESC} (${UUID})"
      fi
    fi
  done
fi

echo "Snapshot + retention complete."
