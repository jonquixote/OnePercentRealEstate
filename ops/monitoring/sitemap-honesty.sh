#!/usr/bin/env bash
# =============================================================================
# sitemap-honesty.sh — alert when the sitemap advertises URLs that don't 200.
#
# The sitemap is how organic discovery finds the product. Two failure modes both
# corrode it silently: the generator breaks (Next 16's generateSitemaps threw
# `r.startsWith is not a function` once and shipped an empty file), or the
# freshness filter drifts out of step with the data so we advertise listings that
# now 404. Either way search engines waste crawl budget on dead URLs and users
# land on gone listings — the same trust damage as a wrong number.
#
# SAMPLE, NEVER SWEEP: the sitemap holds tens of thousands of URLs. Fetching all
# of them on a timer is a self-inflicted load test. Sample a handful (enough to
# catch a systemic break) and use HEAD.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)

BASE="${SITEMAP_PROBE_BASE:-http://127.0.0.1:3001}"
SAMPLE="${SITEMAP_PROBE_SAMPLE:-25}"
MIN_PCT="${SITEMAP_HONESTY_MIN_PCT:-90}"

SITEMAP_XML="$(curl -s -m 30 "${BASE}/sitemap.xml" 2>/dev/null)"
LOC_COUNT="$(printf '%s' "$SITEMAP_XML" | grep -c '<loc>')"

# An empty or unfetchable sitemap is itself the top failure — the generator broke.
if [[ "${LOC_COUNT:-0}" -eq 0 ]]; then
  "$NOTIFY" --key "sitemap-honesty" \
    "🔴 ${BOX}: sitemap-honesty — sitemap.xml returned ZERO <loc> entries (generator broken or empty)
Check: curl -s ${BASE}/sitemap.xml | head" || true
  echo "[sitemap-honesty] 0 loc entries — generator broken"
  exit 0
fi

# Sample URLs, HEAD each, count non-2xx/3xx.
mapfile -t URLS < <(printf '%s' "$SITEMAP_XML" \
  | grep -oE '<loc>[^<]+</loc>' | sed -E 's/<\/?loc>//g' \
  | shuf | head -n "$SAMPLE")

checked=0; ok=0; first_bad=""
for u in "${URLS[@]}"; do
  # Property/market pages are the honesty-critical ones; the probe checks whatever
  # the sitemap actually lists. Rewrite the public base to the local app so the
  # probe works without egress and without depending on DNS/CDN.
  local_url="${u/https:\/\/one.octavo.press/$BASE}"
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -I "$local_url" 2>/dev/null)"
  checked=$((checked + 1))
  if [[ "$code" =~ ^(2|3) ]]; then
    ok=$((ok + 1))
  elif [[ -z "$first_bad" ]]; then
    first_bad="${u} -> ${code}"
  fi
done

[[ "$checked" -eq 0 ]] && { echo "[sitemap-honesty] no URLs sampled" >&2; exit 0; }

pct=$(( 100 * ok / checked ))

if [[ "$pct" -lt "$MIN_PCT" ]]; then
  "$NOTIFY" --key "sitemap-honesty" \
    "🔴 ${BOX}: sitemap-honesty — only ${pct}% of ${checked} sampled sitemap URLs are live (floor ${MIN_PCT}%); ${LOC_COUNT} advertised
First bad: ${first_bad}" || true
else
  if [[ -f "/var/lib/oper-alerts/sitemap-honesty" ]]; then
    "$NOTIFY" --resolved --key "sitemap-honesty" \
      "✅ ${BOX}: sitemap-honesty — RESOLVED (${pct}% of ${checked} sampled live)" || true
  fi
fi
echo "[sitemap-honesty] ${pct}% of ${checked} sampled sitemap URLs live; ${LOC_COUNT} advertised"
