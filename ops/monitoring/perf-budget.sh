#!/usr/bin/env bash
# =============================================================================
# perf-budget.sh — alert when a route's p95 breaches its declared budget.
#
# The gap this closes: every performance problem so far was found by a human
# noticing a page felt slow — the hero at 18.5s, market pages at 10.4s, a
# freshness probe at 8.4s. The app now tracks per-route latency; this compares
# it to the budgets declared in docs/perf/perf-budgets.md and pushes when one
# is broken, so regressions announce themselves.
#
# TWO RULES LEARNED THE HARD WAY FROM db-load-budget.sh:
#   1. Require a minimum sample count. One slow request is not a trend, and an
#      alert that fires on noise gets muted, which is worse than no alert.
#   2. Always emit RESOLVED, so a fixed regression stops nagging.
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
MIN_SAMPLES="${PERF_BUDGET_MIN_SAMPLES:-20}"
APP="${PERF_BUDGET_URL:-http://127.0.0.1:3001/api/admin/perf}"

if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
[[ -z "${ADMIN_API_KEY:-}" ]] && { echo "[perf-budget] ADMIN_API_KEY unset" >&2; exit 0; }

# Budgets in ms, keyed by route (the `withSpan` name). Mirrors the table in
# docs/perf/perf-budgets.md — keep both in step.
budget_for() {
  case "$1" in
    api.stats|api.stats.median-rent|api.markets) echo 300 ;;
    api.stats.health)                            echo 500 ;;
    market.zip|property.id)                      echo 1000 ;;
    # Only routes that are actually instrumented get a budget. A budget for an
    # uninstrumented route never fires and reads as passing — worse than absent.
    *)                                           echo "" ;;
  esac
}

JSON="$(curl -sS -f -m 20 -H "Authorization: Bearer ${ADMIN_API_KEY}" "$APP" 2>/dev/null)"
[[ -z "$JSON" ]] && { echo "[perf-budget] could not read $APP" >&2; exit 0; }

# route<TAB>p95<TAB>count
ROWS="$(printf '%s' "$JSON" | python3 -c '
import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for r in d.get("routes", []):
    print("%s\t%.0f\t%d" % (r.get("route",""), r.get("p95",0), r.get("count",0)))
')"
[[ -z "$ROWS" ]] && { echo "[perf-budget] no routes reported yet"; exit 0; }

breached=0
while IFS=$'\t' read -r route p95 count; do
  [[ -z "$route" ]] && continue
  budget="$(budget_for "$route")"
  [[ -z "$budget" ]] && continue
  key="perf-budget-${route//[^a-zA-Z0-9]/-}"

  if (( count >= MIN_SAMPLES )) && (( p95 > budget )); then
    breached=1
    "$NOTIFY" --key "$key" \
      "🔴 ${BOX}: perf-budget — ${route} p95 ${p95}ms exceeds ${budget}ms budget (${count} samples)" || true
  else
    if [[ -f "/var/lib/oper-alerts/${key}" ]]; then
      "$NOTIFY" --resolved --key "$key" \
        "✅ ${BOX}: perf-budget — ${route} back within budget (p95 ${p95}ms <= ${budget}ms)" || true
    fi
  fi
  echo "[perf-budget] ${route}: p95=${p95}ms budget=${budget}ms samples=${count}"
done <<< "$ROWS"

exit 0
