#!/bin/bash
# Generate alertmanager runtime config from .env values.
# Run as part of deploy or manually: bash ops/systemd/gen-alertmanager.sh
#
# Reads TELEGRAM_BOT_TOKEN and ALERTMANAGER_TELEGRAM_CHAT_ID from .env
# (or the environment). Writes the runtime config that Docker mounts.
set -euo pipefail
# The runtime config embeds the Telegram bot token — never world-readable.
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNTIME_PATH="/opt/onepercent/infrastructure/monitoring/alertmanager/alertmanager.runtime.yml"

# Source .env if not already loaded
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    . "$PROJECT_ROOT/.env"
    set +a
  fi
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN not set. Add it to .env or export it."
  exit 1
fi
if [[ -z "${ALERTMANAGER_TELEGRAM_CHAT_ID:-}" ]]; then
  echo "ERROR: ALERTMANAGER_TELEGRAM_CHAT_ID not set. Add it to .env or export it."
  exit 1
fi

mkdir -p "$(dirname "$RUNTIME_PATH")"

cat > "$RUNTIME_PATH" << YAML
global:
  resolve_timeout: 5m

route:
  receiver: tg-default
  group_by: ["alertname", "severity"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - severity = "crit"
      receiver: tg-crit
      group_wait: 10s
      repeat_interval: 1h
      continue: false

receivers:
  - name: tg-default
    telegram_configs:
      - bot_token: '${TELEGRAM_BOT_TOKEN}'
        chat_id: ${ALERTMANAGER_TELEGRAM_CHAT_ID}
        api_url: https://api.telegram.org
        parse_mode: HTML
        send_resolved: true
        message: |
          <b>[onepercent {{ .Status | toUpper }}]</b> {{ .CommonLabels.alertname }}
          {{ range .Alerts }}{{ .Annotations.summary }}
          {{ .Annotations.description }}
          {{ end }}

  - name: tg-crit
    telegram_configs:
      - bot_token: '${TELEGRAM_BOT_TOKEN}'
        chat_id: ${ALERTMANAGER_TELEGRAM_CHAT_ID}
        api_url: https://api.telegram.org
        parse_mode: HTML
        send_resolved: true
        message: |
          <b>🔴 [onepercent CRIT {{ .Status | toUpper }}]</b> {{ .CommonLabels.alertname }}
          {{ range .Alerts }}{{ .Annotations.summary }}
          {{ .Annotations.description }}
          {{ end }}

inhibit_rules:
  - source_matchers:
      - severity = "crit"
      - alertname =~ "PostgresDown|RedisDown"
    target_matchers:
      - severity = "warn"
    equal: ["host"]
YAML

# Token must not be world-readable, but the alertmanager container runs as
# nobody (uid 65534) and reads this via bind mount — so 0600 + that owner.
# (umask alone leaves root:root, which crashloops alertmanager on restart.)
chmod 0600 "$RUNTIME_PATH"
chown 65534:65534 "$RUNTIME_PATH" 2>/dev/null || true

echo "Alertmanager runtime config written to $RUNTIME_PATH"
