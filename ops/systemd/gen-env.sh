#!/bin/bash
# Generate /etc/oper.env from the project .env with localhost URLs.
# Run once after install, and again whenever .env changes.
#
# Usage:  bash ops/systemd/gen-env.sh
#         systemctl daemon-reload  # pick up new env

set -euo pipefail

PROJECT_ROOT="/opt/onepercent"
SRC="${PROJECT_ROOT}/.env"
DST="/etc/oper.env"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: $SRC not found" >&2
  exit 1
fi

# Source the project .env to get raw values
set -a
. "$SRC"
set +a

# Write the resolved systemd env file with localhost URLs
cat > "$DST" <<EOF
# Auto-generated from ${SRC} by gen-env.sh — do not edit directly.
# Re-run:  bash ${PROJECT_ROOT}/ops/systemd/gen-env.sh && systemctl daemon-reload

# --- Core connection strings (localhost, not Docker hostnames) ---
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/postgres
REDIS_URL=redis://:${REDIS_PASSWORD}@localhost:6379
ML_URL=http://localhost:8000
SCRAPER_URL=http://localhost:8001

# --- Passwords (for services that need the raw values) ---
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}

# --- App config ---
NODE_ENV=production
ML_PORT=8000
PYTHONPATH=${PROJECT_ROOT}/services:${PROJECT_ROOT}/services/scraper_service

# --- Worker tuning ---
WORKER_CONCURRENCY=${WORKER_CONCURRENCY:-2}
RENT_BACKFILL_BATCH=${RENT_BACKFILL_BATCH:-200}
RENT_WORKER_CONCURRENCY=${RENT_WORKER_CONCURRENCY:-6}
RENT_DRAIN_INTERVAL_MS=${RENT_DRAIN_INTERVAL_MS:-30000}
CLUSTER_REFRESH_INTERVAL_MS=${CLUSTER_REFRESH_INTERVAL_MS:-600000}
MEDIA_HEALTH_CONCURRENCY=${MEDIA_HEALTH_CONCURRENCY:-8}
MEDIA_HEALTH_INTERVAL_MS=${MEDIA_HEALTH_INTERVAL_MS:-300000}
WATCHLIST_TICK_MS=${WATCHLIST_TICK_MS:-900000}
WATCHLIST_FROM_EMAIL=${WATCHLIST_FROM_EMAIL:-alerts@octavo.press}
LOG_LEVEL=${LOG_LEVEL:-info}

# --- n8n ---
N8N_HOST=${N8N_HOST:-n8n.octavo.press}
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD:-}
N8N_USER_MANAGEMENT_DISABLED=false
N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY:-}
N8N_INITIAL_USER_EMAIL=${N8N_USER_EMAIL:-}
N8N_INITIAL_USER_PASSWORD=${N8N_PASSWORD:-}
N8N_INITIAL_USER_FIRST_NAME=Admin
N8N_INITIAL_USER_LAST_NAME=OnePercent
WEBHOOK_URL=https://n8n.octavo.press/
GENERIC_TIMEZONE=America/New_York
DB_TYPE=postgresdb
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_HOST=localhost
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}

# --- Pass through any other keys from .env ---
$(grep -E '^(RESEND_API_KEY|OPS_WEBHOOK_URL|CENSUS_API_KEY|NEXT_PUBLIC_|OPENAI_)' "$SRC" 2>/dev/null || true)
EOF

chmod 600 "$DST"
echo "Generated $DST ($(wc -l < "$DST") lines)"
