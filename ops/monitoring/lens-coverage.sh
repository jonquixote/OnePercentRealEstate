#!/usr/bin/env bash
# =============================================================================
# lens-coverage.sh — alert when we can no longer underwrite for a buyer type.
#
# The home page claims we underwrite every property for every kind of buyer.
# That claim is only as true as the inputs behind it, and those inputs decay
# quietly: rent estimates stall behind a worker backlog, sqft goes missing from
# a source, sold comps thin out in a slow season. Nothing about a thinning
# input looks like an error — the page keeps rendering, just with more lenses
# reporting "not enough data" — so without a probe the product degrades into
# the very thing it claims not to be, and no one finds out from the app.
#
# Reported per lens, because "coverage is down" is not actionable and
# "flip coverage 71%, down from 88%" is.
#
#   buy_hold  needs a rent estimate.
#   rehab     needs rent AND sqft (rehab cost is derived per square foot).
#   arv       needs recent comparable sales; gates the flip and BRRRR lenses.
#
# The ARV figure is an UPPER BOUND. It counts listings whose (ZIP, property
# type) has >= MIN_COMPS recent sales, while underwriteDeal() additionally
# restricts comps to a +/-25% sqft band around the subject. Matching that
# exactly would need a per-subject join; the bound moves with the same
# underlying supply, which is what a trend probe needs.
#
# Index-backed by design (bitmap scans on idx_listings_last_seen and
# idx_listings_rent_calc_triage, ~1.5s measured on production). A probe that
# costs more than what it protects is a liability — an earlier one seq-scanned
# for 9.65s twice an hour.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)

# Floors sit below the values measured on 2026-08-02 (89.4 / 86.9 / 34.5) with
# room for normal drift, so a breach means a real regression rather than noise.
MIN_BUY_HOLD="${LENS_COVERAGE_MIN_BUY_HOLD:-80}"
MIN_REHAB="${LENS_COVERAGE_MIN_REHAB:-78}"
MIN_ARV="${LENS_COVERAGE_MIN_ARV:-25}"
MIN_COMPS="${LENS_COVERAGE_MIN_COMPS:-8}"

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[lens-coverage] no DATABASE_URL" >&2; exit 0; }

read -r total buy_hold rehab arv <<<"$(psql "$DB" -tA -F' ' -c "
  WITH comps AS (
    SELECT zip_code, property_type, count(*) AS n
      FROM listings
     WHERE listing_status = 'sold'
       AND sold_date > now() - interval '180 days'
       AND price_per_sqft > 0
     GROUP BY 1, 2)
  SELECT count(*),
         COALESCE(round(100.0 * count(*) FILTER (WHERE a.estimated_rent > 0)
                        / NULLIF(count(*), 0), 1), 0),
         COALESCE(round(100.0 * count(*) FILTER (WHERE a.estimated_rent > 0 AND a.sqft > 0)
                        / NULLIF(count(*), 0), 1), 0),
         COALESCE(round(100.0 * count(*) FILTER (WHERE a.estimated_rent > 0 AND a.sqft > 0
                                                   AND c.n >= ${MIN_COMPS})
                        / NULLIF(count(*), 0), 1), 0)
    FROM listings a
    LEFT JOIN comps c USING (zip_code, property_type)
   WHERE a.listing_status = 'active' AND a.listing_type = 'for_sale';" 2>/dev/null)"

[[ -z "${total:-}" ]] && { echo "[lens-coverage] query failed" >&2; exit 0; }

# Name the lens in the most trouble — the distance below its own floor, so
# lenses with different baselines stay comparable.
worst_lens=""; worst_gap=""
for pair in "buy & hold:${buy_hold}:${MIN_BUY_HOLD}" \
            "rehab (sqft):${rehab}:${MIN_REHAB}" \
            "ARV (flip/BRRRR):${arv}:${MIN_ARV}"; do
  name="${pair%%:*}"; rest="${pair#*:}"; pct="${rest%%:*}"; floor="${rest##*:}"
  gap=$(awk "BEGIN{printf \"%.1f\", $pct - $floor}")
  if [[ -z "$worst_gap" ]] || awk "BEGIN{exit !($gap < $worst_gap)}"; then
    worst_gap="$gap"; worst_lens="$name ${pct}% (floor ${floor}%)"
  fi
done

breached=""
awk "BEGIN{exit !($buy_hold < $MIN_BUY_HOLD)}" && breached+="buy & hold ${buy_hold}% < ${MIN_BUY_HOLD}%; "
awk "BEGIN{exit !($rehab    < $MIN_REHAB)}"    && breached+="rehab ${rehab}% < ${MIN_REHAB}%; "
awk "BEGIN{exit !($arv      < $MIN_ARV)}"      && breached+="ARV ${arv}% < ${MIN_ARV}%; "

summary="buy&hold ${buy_hold}% · rehab ${rehab}% · ARV ${arv}% (of ${total} active for-sale)"

if [[ -n "$breached" ]]; then
  "$NOTIFY" --key "lens-coverage" \
    "🔴 ${BOX}: lens-coverage — ${breached%; }
${summary}
Worst: ${worst_lens}
The home page claims we underwrite for every buyer type; that claim is now thinner than it reads." || true
else
  if [[ -f "/var/lib/oper-alerts/lens-coverage" ]]; then
    "$NOTIFY" --resolved --key "lens-coverage" "✅ ${BOX}: lens-coverage — RESOLVED (${summary})" || true
  fi
fi

echo "[lens-coverage] ${summary}; worst: ${worst_lens}"
