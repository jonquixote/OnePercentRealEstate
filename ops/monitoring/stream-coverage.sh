#!/usr/bin/env bash
# =============================================================================
# stream-coverage.sh — daily production of every crawl stream, side by side.
#
# The crawl feeds three tables and they are comparably productive: measured
# 2026-07-27, listings(for_sale) 9,419 new rows/day, rental_listings 8,276,
# sold_listings 7,536. That measurement is what REFUSED a proposal to rebalance
# crawl passes toward for_sale — it would have traded ~8,000 rental comps and
# ~7,500 sold comps a day for a freshness number.
#
# This panel exists so any future rebalancing proposal can be checked against
# what it costs the other streams, instead of that check depending on somebody
# remembering to run it by hand.
#
# It ALERTS on a stream collapsing, because a stream quietly going to zero is
# invisible in every other probe we have.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
# A stream producing under this many rows a day has effectively stopped. Set an
# order of magnitude below the ~7,500/day floor observed across all three.
MIN_ROWS_24H="${STREAM_MIN_ROWS_24H:-500}"

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[stream-coverage] no DATABASE_URL" >&2; exit 0; }

ROWS="$(psql "$DB" -tA -F' ' -c "
  SELECT 'for_sale', count(*) FILTER (WHERE created_at > now()-interval '24 hours')
    FROM listings WHERE listing_type='for_sale'
  UNION ALL
  SELECT 'rentals', count(*) FILTER (WHERE created_at > now()-interval '24 hours') FROM rental_listings
  UNION ALL
  SELECT 'sold', count(*) FILTER (WHERE created_at > now()-interval '24 hours') FROM sold_listings;" 2>/dev/null)"

[[ -z "$ROWS" ]] && { echo "[stream-coverage] query failed" >&2; exit 0; }

collapsed=""
summary=""
while read -r name n; do
  [[ -z "$name" ]] && continue
  summary+="${name}=${n} "
  (( n < MIN_ROWS_24H )) && collapsed+="${name}(${n}) "
done <<< "$ROWS"

if [[ -n "$collapsed" ]]; then
  "$NOTIFY" --key "stream-coverage" \
    "🔴 ${BOX}: stream-coverage — stream(s) below ${MIN_ROWS_24H} rows/24h: ${collapsed}
All three streams feed real consumers (rent comps, sold comps). A collapsed
stream is invisible in every other probe.
Current: ${summary}" || true
elif [[ -f "/var/lib/oper-alerts/stream-coverage" ]]; then
  "$NOTIFY" --resolved --key "stream-coverage" "✅ ${BOX}: stream-coverage — RESOLVED (${summary})" || true
fi
echo "[stream-coverage] new rows/24h: ${summary}"
