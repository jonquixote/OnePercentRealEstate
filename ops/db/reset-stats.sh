#!/usr/bin/env bash
# Reset the pg_stat_statements baseline. Run this ONCE after deploying the
# /api/admin/db-stats endpoint so the slow-query/index-usage counters start
# accumulating from a clean, attributable baseline. Note the timestamp below.
#
# Usage: DATABASE_URL_DIRECT=postgres://... ./ops/db/reset-stats.sh
# (falls back to DATABASE_URL if DATABASE_URL_DIRECT is unset)
#
# Requires the pg_stat_statements extension to be installed
# (shared_preload_libraries = 'pg_stat_statements') and a role with
# permission to call pg_stat_statements_reset().

set -euo pipefail

DB_URL="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: set DATABASE_URL_DIRECT (or DATABASE_URL) before running." >&2
  exit 2
fi

TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[reset-stats] baseline timestamp: ${TIMESTAMP}"

psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SELECT pg_stat_statements_reset();"

echo "[reset-stats] pg_stat_statements counters reset at ${TIMESTAMP}"
echo "[reset-stats] record this timestamp in documentation/operations/db-performance.md"
