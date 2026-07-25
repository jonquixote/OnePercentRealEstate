#!/usr/bin/env bash
# =============================================================================
# crawl-health.sh — CRAWL PRODUCTIVITY probes. Runs every 10 min via
# oper-crawl-health.timer. Alerts (deduped) via Telegram; RESOLVED on recovery.
#
# Why this exists: on 2026-07-24 the crawl produced ZERO listings for ~10 hours
# and nothing alerted, because every existing monitor asks "is the process
# alive?" — and oper-worker WAS alive, failing 100% of its scrapes (290 errors,
# 0 ok) and re-pending the same job forever. Liveness != productivity.
#
# These probes measure WORK DONE:
#   1. freshness       — are listings still being seen at all?      (the big one)
#   2. completion rate — are crawl jobs finishing while work exists?
#   3. backlog trend   — is pending growing while nothing completes?
#   4. endpoint health — is any scraper endpoint returning ok=0/error>0?
#
# All thresholds are env-overridable (see /etc/oper.env or the unit).
# =============================================================================
set -uo pipefail   # NOT -e: one failing probe must not skip the others

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)
STATE_DIR="/var/lib/oper-crawl-health"
mkdir -p "$STATE_DIR"

# --- Thresholds (env-overridable) -------------------------------------------
CRAWL_FRESH_MAX_MIN="${CRAWL_FRESH_MAX_MIN:-45}"        # no listing seen in N min => alert
CRAWL_BACKLOG_GROW_PROBES="${CRAWL_BACKLOG_GROW_PROBES:-3}"  # consecutive growth before alerting
CRAWL_ENDPOINT_WINDOW_MIN="${CRAWL_ENDPOINT_WINDOW_MIN:-15}" # journal window for endpoint metrics

check_pass() {
  local key="$1"
  if [[ -f "/var/lib/oper-alerts/${key}" ]]; then
    "$NOTIFY" --resolved --key "$key" "✅ ${BOX}: ${key} — RESOLVED" || true
  fi
}
check_fail() {
  local key="$1" msg="$2"
  "$NOTIFY" --key "$key" "🔴 ${BOX}: ${key} — ${msg}" || true
}

# DB access: always DIRECT (:5432). These are tiny read-only probes and must
# keep working even if the pooler is the thing that is broken.
if [[ -f /etc/oper.env ]]; then
  # shellcheck disable=SC1091
  set -a; . /etc/oper.env; set +a
fi
DB="${DATABASE_URL_DIRECT:-${DATABASE_URL:-}}"
if [[ -z "$DB" ]]; then
  echo "[crawl-health] no DATABASE_URL(_DIRECT) — cannot probe" >&2
  exit 0
fi
q() { psql "$DB" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

# --- 1. Freshness — the check that would have caught the 10-hour outage ------
# Index-friendly: idx_listings_last_seen is PARTIAL
# (listing_type='for_sale' AND listing_status IN ('active','pending_verify')),
# so a bare max(last_seen_at) over the whole table cannot use it and cost 9.3s
# per run. Matching the index predicate turns this into a backward index scan.
fresh_min="$(q "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(last_seen_at)))/60, 999999)::int FROM listings WHERE listing_type = 'for_sale' AND listing_status IN ('active','pending_verify')")"
if [[ -z "$fresh_min" ]]; then
  echo "[crawl-health] freshness query failed; skipping" >&2
elif [[ "$fresh_min" -gt "$CRAWL_FRESH_MAX_MIN" ]]; then
  check_fail "crawl-freshness" "no listing seen for ${fresh_min}m (threshold ${CRAWL_FRESH_MAX_MIN}m) — crawl is not producing"
else
  check_pass "crawl-freshness"
fi

# --- 2. Completion rate: work available but nothing finishing ----------------
completed_1h="$(q "SELECT count(*) FROM crawl_jobs WHERE finished_at > now() - interval '1 hour'")"
pending="$(q "SELECT count(*) FROM crawl_jobs WHERE status='pending'")"
if [[ -n "$completed_1h" && -n "$pending" ]]; then
  if [[ "$completed_1h" -eq 0 && "$pending" -gt 0 ]]; then
    check_fail "crawl-throughput" "0 jobs completed in 1h while ${pending} pending — worker is alive but doing no work"
  else
    check_pass "crawl-throughput"
  fi
fi

# --- 3. Backlog trend: pending growing while nothing completes ---------------
# Distinguishes "busy with a big queue" (fine) from "stuck and accumulating".
BACKLOG_STATE="$STATE_DIR/backlog"
prev_backlog=$(cat "$BACKLOG_STATE" 2>/dev/null || echo "")
GROW_STATE="$STATE_DIR/backlog_grow_streak"
grow_streak=$(cat "$GROW_STATE" 2>/dev/null || echo 0)
if [[ -n "$pending" ]]; then
  if [[ -n "$prev_backlog" && "$pending" -gt "$prev_backlog" && "${completed_1h:-0}" -eq 0 ]]; then
    grow_streak=$((grow_streak + 1))
  else
    grow_streak=0
  fi
  echo "$pending" > "$BACKLOG_STATE"
  echo "$grow_streak" > "$GROW_STATE"
  if [[ "$grow_streak" -ge "$CRAWL_BACKLOG_GROW_PROBES" ]]; then
    check_fail "crawl-backlog" "pending backlog grew ${grow_streak} probes straight with 0 completions (now ${pending})"
  else
    check_pass "crawl-backlog"
  fi
fi

# --- 3b. Retire alerts for endpoints that no longer exist --------------------
# A decommissioned endpoint vanishes from the worker's metrics entirely, so the
# per-endpoint probe below can never see it again to clear it — its alert would
# sit "firing" forever (the deleted 10.8.3.41 box did exactly this). Resolve any
# crawl-endpoint-* alert whose URL is no longer in the configured pool.
pool_urls="${SCRAPER_URLS:-${SCRAPER_URL:-}}"
if [[ -n "$pool_urls" ]]; then
  for state in /var/lib/oper-alerts/crawl-endpoint-*; do
    [[ -e "$state" ]] || continue
    key="$(basename "$state")"
    # Rebuild each configured URL's key and keep the alert only if it matches one.
    still_configured=0
    IFS=',' read -ra _eps <<< "$pool_urls"
    for ep in "${_eps[@]}"; do
      ep="$(printf '%s' "$ep" | tr -d '[:space:]')"
      [[ -z "$ep" ]] && continue
      ep_key="crawl-endpoint-$(printf '%s' "$ep" | tr -c 'a-zA-Z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//')"
      [[ "$ep_key" == "$key" ]] && still_configured=1
    done
    if [[ $still_configured -eq 0 ]]; then
      "$NOTIFY" --resolved --key "$key" "✅ ${BOX}: ${key} — endpoint decommissioned, alert retired" || true
    fi
  done
fi

# --- 4. Per-endpoint scraper health -----------------------------------------
# The worker logs `scraper endpoint metrics` per endpoint every 30s with
# ok/blocked/error counters. An endpoint with traffic but zero successes is
# dead to us even though the process is up.
metrics="$(journalctl -u oper-worker --since "-${CRAWL_ENDPOINT_WINDOW_MIN} min" --no-pager 2>/dev/null \
  | grep 'scraper endpoint metrics' | tail -40)"
if [[ -n "$metrics" ]]; then
  # Keep only the LAST line per endpoint URL (counters are cumulative).
  urls="$(printf '%s\n' "$metrics" | grep -oE '"url":"[^"]+"' | sed 's/"url":"//; s/"//' | sort -u)"
  while read -r url; do
    [[ -z "$url" ]] && continue
    last="$(printf '%s\n' "$metrics" | grep -F "\"url\":\"${url}\"" | tail -1)"
    ok=$(printf '%s' "$last"    | grep -oE '"ok":[0-9]+'      | grep -oE '[0-9]+' || echo 0)
    err=$(printf '%s' "$last"   | grep -oE '"error":[0-9]+'   | grep -oE '[0-9]+' || echo 0)
    blocked=$(printf '%s' "$last" | grep -oE '"blocked":[0-9]+' | grep -oE '[0-9]+' || echo 0)
    # Sanitize the URL into an alert key (one key per endpoint so a single dead
    # endpoint is named rather than hidden behind a generic "pool" alert).
    key="crawl-endpoint-$(printf '%s' "$url" | tr -c 'a-zA-Z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//')"
    if [[ "${ok:-0}" -eq 0 && "${err:-0}" -gt 0 ]]; then
      check_fail "$key" "endpoint ${url} has ok=0 error=${err} blocked=${blocked} over ${CRAWL_ENDPOINT_WINDOW_MIN}m — dead endpoint"
    else
      check_pass "$key"
    fi
  done <<< "$urls"
fi
