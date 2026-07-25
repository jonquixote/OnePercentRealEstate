#!/usr/bin/env bash
# =============================================================================
# db-load-budget.sh — alert when ANY single query eats the database.
#
# On 2026-07-25 the Prometheus exporter's `GROUP BY rent_calc_status` was found
# consuming 25,012s of 31,657s total execution time — **79% of all database
# work** — full-scanning 1.3M rows on every metrics scrape, for a gauge nobody
# watches live. Nothing alerted, because nothing was watching for it.
#
# This is that control: hourly, flag any normalized query whose share of total
# execution time exceeds the budget, and name it.
#
# RULE (documented in db-performance.md): a metrics collector may never run an
# unbounded aggregate against `listings`.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
BUDGET_PCT="${DB_LOAD_BUDGET_PCT:-10}"   # alert above this share of total DB time

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[db-load-budget] no DATABASE_URL" >&2; exit 0; }

# Top offender and its share. Excludes pg_stat_statements' own bookkeeping.
read -r pct total_s query <<<"$(psql "$DB" -tA -F'|' -c "
  WITH t AS (SELECT NULLIF(sum(total_exec_time),0) AS total FROM pg_stat_statements)
  SELECT round((s.total_exec_time / t.total * 100)::numeric, 1),
         round((s.total_exec_time/1000)::numeric)::text,
         left(regexp_replace(s.query, '\s+', ' ', 'g'), 120)
  FROM pg_stat_statements s, t
  WHERE s.query NOT ILIKE '%pg_stat_statements%'
  ORDER BY s.total_exec_time DESC
  LIMIT 1;" 2>/dev/null | tr '|' ' ')"

[[ -z "${pct:-}" ]] && { echo "[db-load-budget] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct > $BUDGET_PCT)}"; then
  top5="$(psql "$DB" -tA -c "
    SELECT round((total_exec_time/1000)::numeric)::text || 's  ' ||
           left(regexp_replace(query, '\s+', ' ', 'g'), 70)
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%'
    ORDER BY total_exec_time DESC LIMIT 5;" 2>/dev/null)"
  "$NOTIFY" --key "db-load-budget" \
    "🔴 ${BOX}: db-load-budget — one query is ${pct}% of all DB time (${total_s}s, budget ${BUDGET_PCT}%)
${query}

Top 5 by total time:
${top5}" || true
else
  if [[ -f "/var/lib/oper-alerts/db-load-budget" ]]; then
    "$NOTIFY" --resolved --key "db-load-budget" "✅ ${BOX}: db-load-budget — RESOLVED (top query now ${pct}%)" || true
  fi
fi
echo "[db-load-budget] top query = ${pct}% of total DB time (budget ${BUDGET_PCT}%)"
