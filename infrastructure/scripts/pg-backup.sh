#!/usr/bin/env bash
# Nightly logical backup of the production Postgres (runs on the HOST).
# Writes a compressed custom-format dump, verifies its TOC is readable,
# rotates 7 days. Wave 8 wires backup.log FAIL lines into alerting.
set -euo pipefail

# Dumps contain the entire database (listing PII, agent contact details).
# umask 077 => new files are 0600; the dir is locked to the owner. Keeps a
# full-DB dump off any other account on the host.
umask 077

# /var/backups — OUTSIDE the rsync/deploy target on purpose. The original
# /opt/onepercent/backups vanished on 2026-07-07 (server-side cleanup wiped
# it along with the app tree); the safety net must not live inside the
# thing it protects.
DIR=${BACKUP_DIR:-/var/backups/onepercent}
LOG="$DIR/backup.log"
mkdir -p "$DIR" 2>/dev/null || {
  echo "ERROR: cannot create $DIR (running as $(whoami)?)" >&2
  exit 1
}
chmod 700 "$DIR"
trap 'echo "$(date -Is) FAIL" >> "$LOG"' ERR

STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$DIR/pg_${STAMP}.dump"

docker exec infrastructure-postgres-1 pg_dump -U postgres -d postgres -Fc -Z 6 > "$OUT"

# Integrity gate: a dump whose table of contents can't be listed is garbage.
docker exec -i infrastructure-postgres-1 pg_restore -l < "$OUT" > /dev/null

find "$DIR" -name 'pg_*.dump' -mtime +7 -delete
echo "$(date -Is) ok $OUT $(du -h "$OUT" | cut -f1)" >> "$LOG"
