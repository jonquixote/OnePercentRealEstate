#!/usr/bin/env bash
# Post a short alert to the OPS webhook (Slack-style incoming webhook).
# Usage: notify-ops.sh "message text"
set -euo pipefail

set +u
# shellcheck disable=SC2046
export $(grep -v '^#' /etc/oper.env | grep -v '^$' | xargs)
set -u

MSG="${1:-oper alert}"
if [ -z "${WEBHOOK_URL:-}" ]; then
  echo "WARN: WEBHOOK_URL not set; not sending alert" >&2
  exit 0
fi

curl -sS -X POST -H 'Content-Type: application/json' \
  -d "{\"text\":\"${MSG}\"}" "$WEBHOOK_URL"
echo
