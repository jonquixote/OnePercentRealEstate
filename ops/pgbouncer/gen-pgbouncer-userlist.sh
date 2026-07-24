#!/bin/bash
# Generate pgbouncer/userlist.txt from /etc/oper.env.
# Run after gen-env.sh or whenever a password rotates.
#
# AUTH: every role's password is stored SCRAM-SHA-256 in pg_authid
# (password_encryption=scram-sha-256), so pgbouncer.ini uses
# `auth_type = scram-sha-256`. SCRAM requires the PLAINTEXT password here —
# PgBouncer needs it both to verify the client and to authenticate ITSELF to
# Postgres. An md5 hash cannot do the latter: it would accept clients and then
# fail every server connection (the original md5 generator had this bug).
#
# Output is 0600 root-only and gitignored. Never commit it.
set -euo pipefail

ENV_FILE="/etc/oper.env"
OUT="$(dirname "$0")/userlist.txt"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

read_env() {
  grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true
}

TMP=$(mktemp "${OUT}.XXXXXX")
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT

emit() {
  local role="$1" pass="$2"
  [[ -z "$pass" ]] && return 0
  # Escape backslashes then double quotes for the userlist format.
  local esc=${pass//\\/\\\\}
  esc=${esc//\"/\\\"}
  printf '"%s" "%s"\n' "$role" "$esc" >> "$TMP"
  echo "  + $role"
}

echo "Generating $OUT"
# Superuser (default DATABASE_URL) + every least-privilege role gen-env.sh
# writes a role env file for. A role missing here cannot connect via PgBouncer.
emit postgres      "$(read_env POSTGRES_PASSWORD)"
emit oper_app      "$(read_env OPER_APP_DB_PASSWORD)"
emit oper_worker   "$(read_env OPER_WORKER_DB_PASSWORD)"
emit oper_ml       "$(read_env OPER_ML_DB_PASSWORD)"
emit oper_tileserv "$(read_env OPER_TILESERV_DB_PASSWORD)"
emit oper_exporter "$(read_env OPER_EXPORTER_DB_PASSWORD)"

if [[ ! -s "$TMP" ]]; then
  echo "ERROR: no passwords found in $ENV_FILE — refusing to write an empty userlist" >&2
  exit 1
fi

mv -f "$TMP" "$OUT"
chmod 600 "$OUT"
trap - EXIT
echo "Wrote $OUT ($(wc -l < "$OUT") roles, 0600)"
