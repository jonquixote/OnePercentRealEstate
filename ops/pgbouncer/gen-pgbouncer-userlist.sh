#!/bin/bash
# Generate pgbouncer/userlist.txt from /etc/oper.env POSTGRES_PASSWORD.
# Run after gen-env.sh or whenever the password rotates.
set -euo pipefail

ENV_FILE="/etc/oper.env"
OUT="$(dirname "$0")/userlist.txt"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# shellcheck disable=SC1090
POSTGRES_PASSWORD=$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
if [[ -z "$POSTGRES_PASSWORD" ]]; then
  echo "ERROR: POSTGRES_PASSWORD not set in $ENV_FILE" >&2
  exit 1
fi

# md5 = md5(password + username) — PostgreSQL md5 auth format
# Use printf (shell builtin) instead of echo to avoid password in /proc argv
HASH=$(printf '%s' "${POSTGRES_PASSWORD}postgres" | md5sum | awk '{print $1}')

printf '"postgres" "md5%s"\n' "$HASH" > "$OUT"
chmod 600 "$OUT"
echo "Generated $OUT"
