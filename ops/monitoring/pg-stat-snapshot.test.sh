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

# Capture baseline counts before snapshot
IDX_BEFORE=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM perf_index_scan_history;" 2>/dev/null || echo "0")
STMT_BEFORE=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM perf_statement_history;" 2>/dev/null || echo "0")

bash "$SNAPSHOT"

# Verify rows were added (count must increase)
IDX_AFTER=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM perf_index_scan_history;" 2>/dev/null || echo "0")

STMT_AFTER=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c \
  "SELECT count(*) FROM perf_statement_history;" 2>/dev/null || echo "0")

echo "perf_index_scan_history: ${IDX_BEFORE} -> ${IDX_AFTER}"
echo "perf_statement_history:  ${STMT_BEFORE} -> ${STMT_AFTER}"

if [[ "$IDX_AFTER" -le "$IDX_BEFORE" ]]; then
  echo "FAIL: expected perf_index_scan_history to grow (was ${IDX_BEFORE}, now ${IDX_AFTER})"
  exit 1
fi

if [[ "$STMT_AFTER" -le "$STMT_BEFORE" ]]; then
  echo "FAIL: expected perf_statement_history to grow (was ${STMT_BEFORE}, now ${STMT_AFTER})"
  exit 1
fi

echo "PASS: snapshot added rows to both tables"
