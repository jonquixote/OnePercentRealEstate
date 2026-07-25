#!/usr/bin/env bash
# =============================================================================
# rent-coverage.sh — banded-share coverage AND band integrity.
#
# Two questions, one probe:
#
#   1. COVERAGE. What share of active listings with an estimate also carry a
#      confidence band? This moves as ops/db/backfill-rent-bands.sh runs, and
#      it should never go backwards.
#
#   2. INTEGRITY. Are the bands we do have well-formed? Measured 2026-07-25:
#      zero degenerate/inverted bands, zero half-bands, zero estimates outside
#      their own band, across 1,011,800 rows. That zero is worth defending —
#      it is the reason no bandFor() validation layer was built (see
#      docs/perf/2026-07-rent-band-audit.md). If the model or the write path
#      ever breaks these, this is what tells us.
#
# An integrity breach is more urgent than a coverage dip: a missing band is an
# honest gap, a malformed band is a lie about uncertainty.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
MIN_PCT="${RENT_BANDED_MIN_PCT:-55}"   # set just under the measured 59.3%; raise as the backfill lands

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[rent-coverage] no DATABASE_URL" >&2; exit 0; }

read -r pct unbanded <<<"$(psql "$DB" -tA -F' ' -c "
  SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE rent_low IS NOT NULL)
                        / NULLIF(count(*), 0), 1), 0),
         count(*) FILTER (WHERE rent_low IS NULL)
    FROM listings
   WHERE listing_status = 'active' AND listing_type = 'for_sale'
     AND estimated_rent IS NOT NULL;" 2>/dev/null)"

bad="$(psql "$DB" -tA -c "
  SELECT count(*) FROM listings
   WHERE (rent_low IS NOT NULL) <> (rent_high IS NOT NULL)
      OR (rent_low IS NOT NULL AND rent_high <= rent_low)
      OR (rent_low IS NOT NULL AND estimated_rent NOT BETWEEN rent_low AND rent_high);" 2>/dev/null | tr -d '[:space:]')"

[[ -z "${pct:-}" || -z "${bad:-}" ]] && { echo "[rent-coverage] query failed" >&2; exit 0; }

if (( bad > 0 )); then
  "$NOTIFY" --key "rent-band-integrity" \
    "🔴 ${BOX}: rent-band-integrity — ${bad} malformed bands (inverted, half-populated, or estimate outside its own band). This was 0 on 2026-07-25 across 1,011,800 rows." || true
elif [[ -f "/var/lib/oper-alerts/rent-band-integrity" ]]; then
  "$NOTIFY" --resolved --key "rent-band-integrity" "✅ ${BOX}: rent-band-integrity — RESOLVED (0 malformed)" || true
fi

if awk "BEGIN{exit !($pct < $MIN_PCT)}"; then
  "$NOTIFY" --key "rent-coverage" \
    "🔴 ${BOX}: rent-coverage — only ${pct}% of estimated active listings carry a band (floor ${MIN_PCT}%); ${unbanded} unbanded
Run: ops/db/backfill-rent-bands.sh" || true
elif [[ -f "/var/lib/oper-alerts/rent-coverage" ]]; then
  "$NOTIFY" --resolved --key "rent-coverage" "✅ ${BOX}: rent-coverage — RESOLVED (${pct}%)" || true
fi

echo "[rent-coverage] ${pct}% banded; ${unbanded} unbanded; ${bad} malformed"
