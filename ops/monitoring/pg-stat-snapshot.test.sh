#!/usr/bin/env bash
# Test: run pg-stat-snapshot once and verify at least 1 row was inserted
# into each history table. Requires DATABASE_URL_DIRECT (or DATABASE_URL).
# Skips gracefully if no DB is available.
set -euo pipefail

DB_URL="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"

if [ -z "$DB_URL" ]; then
  echo "SKIP: no DATABASE_URL_DIRECT or DATABASE_URL set"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOT="${SCRIPT_DIR}/pg-stat-snapshot.sh"

if [[ ! -x "$SNAPSHOT" ]]; then
  echo "FAIL: ${SNAPSHOT} not found or not executable"
  exit 1
fi

echo "Running snapshot..."
bash "$SNAPSHOT"

# Verify rows exist
IDX_COUNT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM perf_index_scan_history;" 2>/dev/null || echo "0")

STMT_COUNT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM perf_statement_history;" 2>/dev/null || echo "0")

echo "perf_index_scan_history rows: ${IDX_COUNT}"
echo "perf_statement_history rows:  ${STMT_COUNT}"

if [[ "$IDX_COUNT" -lt 1 ]]; then
  echo "FAIL: expected >= 1 row in perf_index_scan_history"
  exit 1
fi

if [[ "$STMT_COUNT" -lt 1 ]]; then
  echo "FAIL: expected >= 1 row in perf_statement_history"
  exit 1
fi

echo "PASS: snapshot inserted rows into both tables"
