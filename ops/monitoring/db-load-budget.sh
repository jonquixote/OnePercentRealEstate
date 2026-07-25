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

# DELTA-BASED, not cumulative. pg_stat_statements totals are since the last
# reset, so a problem that has already been FIXED would keep alerting forever
# while a NEW one hides behind its history. We snapshot per-query totals each
# run and evaluate the share of work done *since the previous run*.
STATE="/var/lib/oper-db-budget/prev.tsv"
mkdir -p "$(dirname "$STATE")"

CUR="$(psql "$DB" -tA -F$'\t' -c "
  SELECT queryid, round(total_exec_time)::bigint, left(regexp_replace(query, '\s+', ' ', 'g'), 120)
  FROM pg_stat_statements
  WHERE query NOT ILIKE '%pg_stat_statements%' AND queryid IS NOT NULL;" 2>/dev/null)"

if [[ -z "$CUR" ]]; then
  echo "[db-load-budget] query failed" >&2; exit 0
fi

if [[ ! -s "$STATE" ]]; then
  printf '%s\n' "$CUR" > "$STATE"
  echo "[db-load-budget] baseline captured; deltas evaluated from the next run"
  exit 0
fi

# Join previous totals to current and compute this window's share.
read -r pct total_s query <<<"$(awk -F'\t' '
  NR==FNR { prev[$1]=$2; next }
  {
    d = $2 - (($1 in prev) ? prev[$1] : 0)
    if (d < 0) d = $2           # counters reset since last run
    tot += d
    if (d > maxd) { maxd = d; maxq = $3 }
  }
  END {
    if (tot <= 0) { print "0 0 none"; exit }
    printf "%.1f %d %s\n", (maxd/tot)*100, maxd/1000, maxq
  }' "$STATE" <(printf '%s\n' "$CUR"))"

printf '%s\n' "$CUR" > "$STATE"

[[ -z "${pct:-}" ]] && { echo "[db-load-budget] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct > $BUDGET_PCT)}"; then
  "$NOTIFY" --key "db-load-budget" \
    "🔴 ${BOX}: db-load-budget — one query used ${pct}% of DB time THIS WINDOW (${total_s}s, budget ${BUDGET_PCT}%)
${query}" || true
else
  if [[ -f "/var/lib/oper-alerts/db-load-budget" ]]; then
    "$NOTIFY" --resolved --key "db-load-budget" "✅ ${BOX}: db-load-budget — RESOLVED (top query now ${pct}%)" || true
  fi
fi
echo "[db-load-budget] top query = ${pct}% of total DB time (budget ${BUDGET_PCT}%)"
