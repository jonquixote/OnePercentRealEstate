#!/usr/bin/env bash
# =============================================================================
# crawl-throughput.sh — confirmations per hour, against what the SLO needs.
#
# A listing is CONFIRMED when a scrape returns it and the upsert advances
# last_seen_at. That is the unit the freshness SLO is denominated in, and until
# 2026-08-12 nothing measured it: crawl_jobs.listings_found stored only
# `inserted`, the small minority, while updates — the bulk of the work — were
# recorded nowhere. Every throughput figure had to be reconstructed by hand, and
# two such reconstructions this session were wrong.
#
# The requirement is arithmetic, not opinion: to confirm every active listing
# within the SLO window, we must sustain (active / window_days / 24) per hour.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[crawl-throughput] no DATABASE_URL" >&2; exit 0; }

# Same window the freshness SLO uses, from the same source, so the requirement
# and the achievement can never be computed against different targets.
STALE_AFTER_DAYS="${STALE_AFTER_DAYS:-10}"
WINDOW_DAYS="${FRESHNESS_WINDOW_DAYS:-$STALE_AFTER_DAYS}"
# Alert only on a sustained shortfall against the window we actually promise.
MIN_PCT_OF_REQUIRED="${THROUGHPUT_MIN_PCT:-70}"

read -r confirmed_1h active required pct <<<"$(psql "$DB" -tA -F' ' -c "
  WITH a AS (
    SELECT count(*)::numeric AS active
      FROM listings WHERE listing_status='active' AND listing_type='for_sale'
  ), c AS (
    SELECT count(*)::numeric AS confirmed
      FROM listings WHERE last_seen_at > now() - interval '1 hour'
  )
  SELECT c.confirmed::bigint,
         a.active::bigint,
         ceil(a.active / ${WINDOW_DAYS} / 24)::bigint AS required,
         COALESCE(round(100.0 * c.confirmed / NULLIF(ceil(a.active / ${WINDOW_DAYS} / 24), 0), 1), 0)
    FROM a, c;" 2>/dev/null)"

[[ -z "${confirmed_1h:-}" ]] && { echo "[crawl-throughput] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct < $MIN_PCT_OF_REQUIRED)}"; then
  "$NOTIFY" --key "crawl-throughput" \
    "🔴 ${BOX}: crawl-throughput — ${confirmed_1h} confirmations in the last hour, ${pct}% of the ${required}/hr needed to sweep ${active} active listings within ${WINDOW_DAYS}d (floor ${MIN_PCT_OF_REQUIRED}%)
Confirmations = inserted + updated. 'Skipped' rows were already fresh today." || true
else
  if [[ -f "/var/lib/oper-alerts/crawl-throughput" ]]; then
    "$NOTIFY" --resolved --key "crawl-throughput" "✅ ${BOX}: crawl-throughput — RESOLVED (${pct}% of required)" || true
  fi
fi
echo "[crawl-throughput] ${confirmed_1h} confirmations/hr = ${pct}% of the ${required}/hr needed for a ${WINDOW_DAYS}d sweep of ${active} active listings"
