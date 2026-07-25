#!/usr/bin/env bash
# =============================================================================
# photo-coverage.sh — alert when active listings that HAVE images stop showing one.
#
# This gap sat at 99.97% broken for months and nothing noticed: 446,437 active
# listings had images, 140 had the readable column, and /api/properties/viewport
# returned 0 photos out of 293 rows. One route even carried a code comment
# correctly diagnosing it. No signal distinguished "no photo available" from
# "photo available but not readable", so nothing ever escalated.
#
# DENOMINATOR IS DELIBERATE: listings that HAVE images. Measuring against all
# listings would let genuinely imageless inventory mask a read-path regression.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
MIN_PCT="${PHOTO_COVERAGE_MIN_PCT:-95}"

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[photo-coverage] no DATABASE_URL" >&2; exit 0; }

read -r pct fillable <<<"$(psql "$DB" -tA -F' ' -c "
  SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE primary_photo IS NOT NULL)
                        / NULLIF(count(*), 0), 1), 0),
         count(*) FILTER (WHERE primary_photo IS NULL)
    FROM listings
   WHERE listing_status = 'active' AND listing_type = 'for_sale'
     AND images IS NOT NULL AND jsonb_array_length(images) > 0;" 2>/dev/null)"

[[ -z "${pct:-}" ]] && { echo "[photo-coverage] query failed" >&2; exit 0; }

if awk "BEGIN{exit !($pct < $MIN_PCT)}"; then
  "$NOTIFY" --key "photo-coverage" \
    "🔴 ${BOX}: photo-coverage — only ${pct}% of image-bearing active listings expose a photo (floor ${MIN_PCT}%); ${fillable} fillable rows waiting
Run: ops/db/backfill-primary-photo.sh" || true
else
  if [[ -f "/var/lib/oper-alerts/photo-coverage" ]]; then
    "$NOTIFY" --resolved --key "photo-coverage" "✅ ${BOX}: photo-coverage — RESOLVED (${pct}%)" || true
  fi
fi
echo "[photo-coverage] ${pct}% of image-bearing active listings expose a photo; ${fillable} fillable"
