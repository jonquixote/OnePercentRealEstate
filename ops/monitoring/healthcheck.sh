#!/usr/bin/env bash
# Host + service healthcheck — runs every 2 min via oper-healthcheck.timer.
# Alerts via Telegram on breach; sends RESOLVED when check clears.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFY="${SCRIPT_DIR}/notify-telegram.sh"
BOX=$(hostname)

# Thresholds
MEM_AVAIL_PCT_MIN=10    # alert if mem available < 10%
SWAP_USED_PCT_MAX=75    # alert if swap used > 75%
DISK_USED_PCT_MAX=85    # alert if disk / used > 85%

check_pass() {
  local key="$1"
  # Send resolved if previously alerting
  if [[ -f "/run/oper-alerts/${key}" ]]; then
    "$NOTIFY" --resolved --key "$key" "✅ ${BOX}: ${key} — RESOLVED"
  fi
}

check_fail() {
  local key="$1"
  local msg="$2"
  "$NOTIFY" --key "$key" "🔴 ${BOX}: ${key} — ${msg}"
}

# --- Memory available ---
mem_total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
mem_avail_pct=$(( mem_avail * 100 / mem_total ))
if [[ $mem_avail_pct -lt $MEM_AVAIL_PCT_MIN ]]; then
  check_fail "mem-available" "Memory available ${mem_avail_pct}% (threshold: ${MEM_AVAIL_PCT_MIN}%)"
else
  check_pass "mem-available"
fi

# --- Swap used ---
swap_total=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
swap_free=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
if [[ $swap_total -gt 0 ]]; then
  swap_used_pct=$(( (swap_total - swap_free) * 100 / swap_total ))
  if [[ $swap_used_pct -gt $SWAP_USED_PCT_MAX ]]; then
    check_fail "swap-used" "Swap used ${swap_used_pct}% (threshold: ${SWAP_USED_PCT_MAX}%)"
  else
    check_pass "swap-used"
  fi
fi

# --- Disk / ---
disk_used_pct=$(df / --output=pcent | tail -1 | tr -d '% ')
if [[ $disk_used_pct -gt $DISK_USED_PCT_MAX ]]; then
  check_fail "disk-root" "Disk / used ${disk_used_pct}% (threshold: ${DISK_USED_PCT_MAX}%)"
else
  check_pass "disk-root"
fi

# --- oper-* units ---
for unit in $(systemctl list-units --type=service --plain --no-legend | awk '/oper-/ {print $1}'); do
  key="unit-${unit}"
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    check_pass "$key"
  else
    check_fail "$key" "Unit ${unit} is not active"
  fi
done

# --- HTTP health (oper-app on port 3001) ---
if curl -sf -m5 http://127.0.0.1:3001/api/health | grep -q '"status":"ok"'; then
  check_pass "http-app"
else
  check_fail "http-app" "HTTP health check failed on port 3001"
fi

# --- oper-two reachability ---
if curl -sf -m5 http://127.0.0.1:3002/ >/dev/null 2>&1; then
  check_pass "http-two"
else
  check_fail "http-two" "oper-two unreachable on port 3002"
fi
