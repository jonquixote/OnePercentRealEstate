#!/usr/bin/env bash
# =============================================================================
# inventory-freshness.sh — is "active" still meaningful?
#
# On 2026-07-26, of 446,270 listings the product called active, only 29% had
# been confirmed by the crawler within three days and 101,864 (22.8%) had not
# been seen in over a week. Nothing measured this, so nobody knew.
#
# The SLO is set from what the crawl ACHIEVES, not from what would be nice: the
# sweep is ~6 days, so a 7-day confirmation floor is the honest target. Raise it
# when throughput improves; do not set it to a number the crawl cannot reach, or
# the alert becomes noise and gets muted.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
WINDOW_DAYS="${FRESHNESS_WINDOW_DAYS:-7}"
MIN_PCT="${FRESHNESS_MIN_PCT:-75}"

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[inventory-freshness] no DATABASE_URL" >&2; exit 0; }

# Index-backed: matches idx_listings_last_seen's partial predicate rather than
# scanning 11 GB. Matching that index once took a probe from 8,435ms to 0.134ms.
read -r pct unconfirmed <<<"$(psql "$DB" -tA -F' ' -c "
  SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE last_seen_at > now() - interval '${WINDOW_DAYS} days')
                        / NULLIF(count(*), 0), 1), 0),
         count(*) FILTER (WHERE last_seen_at IS NULL
                            OR last_seen_at <= now() - interval '${WINDOW_DAYS} days')
    FROM listings
   WHERE listing_status = 'active' AND listing_type = 'for_sale';" 2>/dev/null)"

[[ -z "${pct:-}" ]] && { echo "[inventory-freshness] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct < $MIN_PCT)}"; then
  "$NOTIFY" --key "inventory-freshness" \
    "🔴 ${BOX}: inventory-freshness — only ${pct}% of active listings confirmed within ${WINDOW_DAYS}d (floor ${MIN_PCT}%); ${unconfirmed} unconfirmed
The product shows these as active. Check crawl throughput before trusting deal alerts." || true
else
  if [[ -f "/var/lib/oper-alerts/inventory-freshness" ]]; then
    "$NOTIFY" --resolved --key "inventory-freshness" "✅ ${BOX}: inventory-freshness — RESOLVED (${pct}%)" || true
  fi
fi
echo "[inventory-freshness] ${pct}% of active listings confirmed within ${WINDOW_DAYS}d; ${unconfirmed} unconfirmed"
