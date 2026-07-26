#!/usr/bin/env bash
# =============================================================================
# image-availability.sh — is the one CDN our entire visual layer depends on
# still serving?
#
# Every listing photo comes from rdcpix.com (401,562 ap. + 40,019 nh. on
# 2026-07-25 — one host, two subdomains). Hotlink protection, a rate limit, or a
# URL scheme change would take the product from 100% photo coverage to 0% with
# no warning. Before 2026-07-25 only 140 listings had a readable photo, so there
# was nothing to lose; now there is.
#
# SAMPLES, NEVER SWEEPS: 441,581 images at ~120 KB is ~53 GB. A probe that
# checked them all would be a denial-of-service against a CDN we do not own.
# HEAD only, small sample, on a slow timer.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
SAMPLE="${IMAGE_SAMPLE_SIZE:-25}"
MIN_PCT="${IMAGE_AVAILABILITY_MIN_PCT:-90}"

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
[[ -z "$DB" ]] && { echo "[image-availability] no DATABASE_URL" >&2; exit 0; }

# TABLESAMPLE, not ORDER BY random(): random() sorts the whole table, which on
# 1.3M rows is exactly the kind of unbounded scan that once cost 79% of all
# database time.
urls="$(psql "$DB" -tA -c "
  SELECT primary_photo FROM listings TABLESAMPLE SYSTEM (0.5)
   WHERE primary_photo IS NOT NULL AND listing_status = 'active'
   LIMIT ${SAMPLE};" 2>/dev/null)"

[[ -z "$urls" ]] && { echo "[image-availability] no sample returned" >&2; exit 0; }

ok=0; total=0; example=""
while IFS= read -r u; do
  [[ -z "$u" ]] && continue
  total=$(( total + 1 ))
  code=$(curl -s -I -m 15 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null)
  if [[ "$code" == "200" ]]; then ok=$(( ok + 1 ));
  elif [[ -z "$example" ]]; then example="${code} ${u:0:80}"; fi
done <<< "$urls"

(( total == 0 )) && { echo "[image-availability] nothing sampled" >&2; exit 0; }
pct=$(awk "BEGIN{printf \"%.0f\", ($ok/$total)*100}")

if (( pct < MIN_PCT )); then
  "$NOTIFY" --key "image-availability" \
    "🔴 ${BOX}: image-availability — only ${pct}% of sampled listing photos returned 200 (${ok}/${total}, floor ${MIN_PCT}%)
Every photo comes from rdcpix; if this is sustained the product goes imageless.
First failure: ${example:-n/a}" || true
else
  if [[ -f "/var/lib/oper-alerts/image-availability" ]]; then
    "$NOTIFY" --resolved --key "image-availability" "✅ ${BOX}: image-availability — RESOLVED (${pct}%)" || true
  fi
fi
echo "[image-availability] ${pct}% of ${total} sampled photos returned 200"
