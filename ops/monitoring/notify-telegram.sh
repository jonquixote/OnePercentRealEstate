#!/usr/bin/env bash
# Deduped Telegram notifier — reads creds from env/oper.env.
# Usage: notify-telegram.sh [--key <id>] [--resolved] "message text"
#   --key <id>   Dedup key; same key won't re-alert within COOLDOWN (default 30 min)
#                When the key clears (no call for COOLDOWN), a RESOLVED message is sent.
#   --resolved   Send a RESOLVED message for the given key and remove state file.
set -euo pipefail

STATE_DIR="/run/oper-alerts"
COOLDOWN=1800  # 30 minutes in seconds

set +u
if [[ -f /etc/oper.env ]]; then
  export $(grep -v '^#' /etc/oper.env | grep -v '^$' | xargs)
fi
set -u

KEY=""
MSG=""
RESOLVED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --resolved) RESOLVED=true; shift ;;
    *) MSG="$1"; shift ;;
  esac
done

if [[ "$RESOLVED" == false && -z "$MSG" ]]; then
  echo "Usage: notify-telegram.sh [--key <id>] [--resolved] \"message\"" >&2
  exit 1
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${ALERTMANAGER_TELEGRAM_CHAT_ID:-}" ]]; then
  echo "WARN: TELEGRAM_BOT_TOKEN or ALERTMANAGER_TELEGRAM_CHAT_ID not set; skipping" >&2
  exit 0
fi

send_telegram() {
  local text="$1"
  curl -sS -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${ALERTMANAGER_TELEGRAM_CHAT_ID}" \
    -d text="${text}" \
    -d parse_mode="Markdown" \
    --max-time 10 >/dev/null
}

mkdir -p "$STATE_DIR"

if [[ -n "$KEY" ]]; then
  STATE_FILE="${STATE_DIR}/${KEY}"

  if [[ "$RESOLVED" == true ]]; then
    if [[ -f "$STATE_FILE" ]]; then
      rm -f "$STATE_FILE"
      send_telegram "✅ *RESOLVED* — $(hostname)
Key: ${KEY}
${MSG:-Alert cleared}"
    fi
    exit 0
  fi

  NOW=$(date +%s)

  if [[ -f "$STATE_FILE" ]]; then
    LAST=$(cat "$STATE_FILE")
    ELAPSED=$(( NOW - LAST ))
    if [[ $ELAPSED -lt $COOLDOWN ]]; then
      echo "Suppressed: $KEY (last alert ${ELAPSED}s ago, cooldown ${COOLDOWN}s)"
      exit 0
    fi
  fi

  echo "$NOW" > "$STATE_FILE"
  send_telegram "🔴 *ALERT* — $(hostname)
${MSG}"
else
  send_telegram "🔴 *ALERT* — $(hostname)
${MSG}"
fi
