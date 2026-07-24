#!/usr/bin/env bash
# Weekly snapshot of pg_stat_user_indexes + pg_stat_statements into
# perf_index_scan_history / perf_statement_history trend tables.
#
# Used by oper-pg-stat.timer (weekly). Idempotent table creation on every run.
# Index-drop decisions must read the DELTA across >=2 weekly snapshots —
# never a single reading.
#
# Usage: DATABASE_URL_DIRECT=postgres://... ./ops/monitoring/pg-stat-snapshot.sh
# (falls back to DATABASE_URL if DATABASE_URL_DIRECT is unset)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)

DB_URL="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: set DATABASE_URL_DIRECT (or DATABASE_URL) before running." >&2
  exit 2
fi

KEY="pg-stat-snapshot"

fail() {
  local msg="$1"
  echo "ERROR: ${msg}" >&2
  if [[ -x "$NOTIFY" ]]; then
    "$NOTIFY" --key "$KEY" "RED ${BOX}: pg-stat-snapshot — ${msg}" || true
  fi
  exit 1
}

# --- Idempotent table creation ---
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE TABLE IF NOT EXISTS perf_index_scan_history (
  captured_at   TIMESTAMPTZ NOT NULL,
  schemaname    TEXT,
  relname       TEXT,
  indexrelname  TEXT,
  idx_scan      BIGINT,
  idx_blks_read BIGINT,
  size_bytes    BIGINT
);

CREATE TABLE IF NOT EXISTS perf_statement_history (
  captured_at      TIMESTAMPTZ NOT NULL,
  query            TEXT,
  calls            BIGINT,
  mean_exec_time   DOUBLE PRECISION,
  total_exec_time  DOUBLE PRECISION
);
SQL

echo "[pg-stat-snapshot] tables ready"

# --- Snapshot index usage ---
IDX_ROWS=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c "
INSERT INTO perf_index_scan_history
SELECT now(),
       schemaname,
       relname,
       indexrelname,
       idx_scan,
       idx_blks_read,
       pg_relation_size(indexrelid)
FROM pg_stat_user_indexes
RETURNING 1;
" 2>&1) || fail "index snapshot failed: ${IDX_ROWS}"

IDX_COUNT=$(echo "$IDX_ROWS" | grep -c '^1$' || echo 0)
echo "[pg-stat-snapshot] inserted ${IDX_COUNT} index rows"

# --- Snapshot top-N slow queries ---
STMT_ROWS=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -t -A -c "
INSERT INTO perf_statement_history
SELECT now(),
       query,
       calls,
       mean_exec_time,
       total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 50
RETURNING 1;
" 2>&1) || fail "statement snapshot failed: ${STMT_ROWS}"

STMT_COUNT=$(echo "$STMT_ROWS" | grep -c '^1$' || echo 0)
echo "[pg-stat-snapshot] inserted ${STMT_COUNT} statement rows"

echo "[pg-stat-snapshot] complete at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
