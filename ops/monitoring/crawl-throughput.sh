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
# Alert only on a SUSTAINED shortfall. Hourly confirmation counts are noisy —
# measured 1,196 and 1,979 within the same session — so a one-hour sample against
# a 70% floor would flap and train everyone to ignore it. Average over 6 hours,
# which is long enough to smooth per-ZIP size variance and short enough to catch
# a crawl that has genuinely stalled.
AVG_HOURS="${THROUGHPUT_AVG_HOURS:-6}"
MIN_PCT_OF_REQUIRED="${THROUGHPUT_MIN_PCT:-70}"

# ZIP SWEEP INTERVAL is what actually governs freshness. Confirmations/hour
# conflates "more rows per visit" with "more visits" — measured 2026-07-28, a
# concurrency change raised confirmations 57% while ZIP coverage FELL and 7-day
# freshness went 72.0% -> 68.9%. A listing is only re-confirmed when its ZIP is
# swept, so sweep interval sets the age distribution.
# See docs/perf/2026-08-zip-sweep-is-the-metric.md.
read -r zips_6h active_zips sweep_days <<<"$(psql "$DB" -tA -F' ' -c "
  SELECT (SELECT count(DISTINCT region_value) FROM crawl_jobs
           WHERE finished_at > now() - interval '6 hours')::bigint,
         (SELECT count(DISTINCT zip_code) FROM listings
           WHERE listing_status='active' AND listing_type='for_sale'
             AND zip_code ~ '^[0-9]{5}$')::bigint,
         COALESCE(round((SELECT count(DISTINCT zip_code) FROM listings
                          WHERE listing_status='active' AND listing_type='for_sale'
                            AND zip_code ~ '^[0-9]{5}$')::numeric
                        / NULLIF((SELECT count(DISTINCT region_value) FROM crawl_jobs
                                   WHERE finished_at > now() - interval '6 hours'), 0)
                        / 4.0, 1), 0);" 2>/dev/null)"

read -r confirmed_1h active required pct <<<"$(psql "$DB" -tA -F' ' -c "
  WITH a AS (
    SELECT count(*)::numeric AS active
      FROM listings WHERE listing_status='active' AND listing_type='for_sale'
  ), c AS (
    SELECT count(*)::numeric / ${AVG_HOURS} AS confirmed
      FROM listings WHERE last_seen_at > now() - interval '${AVG_HOURS} hours'
  )
  SELECT c.confirmed::bigint,
         a.active::bigint,
         ceil(a.active / ${WINDOW_DAYS} / 24)::bigint AS required,
         COALESCE(round(100.0 * c.confirmed / NULLIF(ceil(a.active / ${WINDOW_DAYS} / 24), 0), 1), 0)
    FROM a, c;" 2>/dev/null)"

[[ -z "${confirmed_1h:-}" ]] && { echo "[crawl-throughput] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct < $MIN_PCT_OF_REQUIRED)}"; then
  "$NOTIFY" --key "crawl-throughput" \
    "🔴 ${BOX}: crawl-throughput — ${confirmed_1h} confirmations/hr averaged over ${AVG_HOURS}h, ${pct}% of the ${required}/hr needed to sweep ${active} active listings within ${WINDOW_DAYS}d (floor ${MIN_PCT_OF_REQUIRED}%)
Confirmations = inserted + updated. 'Skipped' rows were already fresh today." || true
else
  if [[ -f "/var/lib/oper-alerts/crawl-throughput" ]]; then
    "$NOTIFY" --resolved --key "crawl-throughput" "✅ ${BOX}: crawl-throughput — RESOLVED (${pct}% of required)" || true
  fi
fi
echo "[crawl-throughput] ${confirmed_1h} confirmations/hr (${AVG_HOURS}h avg) = ${pct}% of the ${required}/hr needed for a ${WINDOW_DAYS}d sweep of ${active} active listings"
# The number that actually sets the freshness age distribution.
echo "[crawl-throughput] ZIP SWEEP: ${zips_6h} ZIPs in 6h of ${active_zips} active => full sweep every ~${sweep_days}d (SLO window ${WINDOW_DAYS}d)"
