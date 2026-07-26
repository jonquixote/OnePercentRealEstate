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

# URL-encode a value for embedding in a postgresql:// connection string
# (encodeURIComponent semantics: encodes everything except unreserved chars).
urlencode() {
  python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"
}

# --- PgBouncer cutover decision (FAIL-SAFE) ---------------------------------
# DATABASE_URL uses the pooler (:6432) ONLY when BOTH are true:
#   1. the operator opted in    → USE_PGBOUNCER=1 in .env
#   2. the pooler is verifiably answering a real query RIGHT NOW
# Otherwise we fall back to direct :5432 and say so loudly. On 2026-07-24 a
# blind cutover to :6432 while PgBouncer was not even installed took the app
# offline (health 503, db down); this check makes that outcome impossible —
# the worst case is "no pooling", never "no database".
DB_PORT=5432
if [[ "${USE_PGBOUNCER:-0}" == "1" ]]; then
  if systemctl is-active --quiet oper-pgbouncer 2>/dev/null \
     && PGPASSWORD="${POSTGRES_PASSWORD}" psql -h 127.0.0.1 -p 6432 -U postgres \
          -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
    DB_PORT=6432
    echo "  PgBouncer verified on :6432 — DATABASE_URL will use the pooler"
  else
    echo "  WARNING: USE_PGBOUNCER=1 but PgBouncer is not answering on :6432." >&2
    echo "           Falling back to DIRECT :5432 (run ops/pgbouncer/setup-pgbouncer.sh)." >&2
  fi
else
  echo "  PgBouncer opt-in off (USE_PGBOUNCER != 1) — DATABASE_URL uses direct :5432"
fi

# Write the resolved systemd env file with localhost URLs
cat > "$DST" <<EOF
# Auto-generated from ${SRC} by gen-env.sh — do not edit directly.
# Re-run:  bash ${PROJECT_ROOT}/ops/systemd/gen-env.sh && systemctl daemon-reload

# --- Core connection strings (localhost, not Docker hostnames) ---
# DATABASE_URL port is decided above: :6432 (PgBouncer) only when opted in AND
# verified live, else :5432 direct. DATABASE_URL_DIRECT is ALWAYS :5432 — it is
# what LISTEN clients (crawl, rent-estimator) and migrations must use.
DATABASE_URL=postgresql://postgres:$(urlencode "${POSTGRES_PASSWORD}")@localhost:${DB_PORT}/postgres
DATABASE_URL_DIRECT=postgresql://postgres:$(urlencode "${POSTGRES_PASSWORD}")@localhost:5432/postgres
REDIS_URL=redis://:$(urlencode "${REDIS_PASSWORD}")@localhost:6379
ML_URL=http://localhost:8000
# Scraper may be detached to an isolated box (to contain upstream IP blocks).
# Its address is environment-specific, so it is read from the server-only .env
# (SCRAPER_URL=...) and never committed. Falls back to the local scraper.
SCRAPER_URL=${SCRAPER_URL:-http://localhost:8001}
# Pool of scraper endpoints (comma-separated) for per-IP AIMD pacing. Emitted
# EXPLICITLY because the passthrough filter below matches ^SCRAPER_URL as a
# prefix, which silently swallowed SCRAPER_URLS from .env — leaving the pool
# with only a dead endpoint and stalling the crawl (2026-07-24).
# Defaults to the local scraper so the crawl always has ONE working endpoint.
SCRAPER_URLS=${SCRAPER_URLS:-http://127.0.0.1:8001}

# --- Passwords (for services that need the raw values) ---
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}

# --- App config ---
NODE_ENV=production
ML_PORT=8000
PYTHONPATH=${PROJECT_ROOT}/services:${PROJECT_ROOT}/services/scraper_service

# --- Worker tuning ---
# Serialized (1) to mimic the old n8n workflow's one-ZIP-at-a-time cadence,
# which avoided Realtor.com IP blocks for months.
WORKER_CONCURRENCY=${WORKER_CONCURRENCY:-1}
# Per-scrape-pass HTTP timeout. Kept modest so a hung/OOM'd scraper request
# ties up a runner for minutes, not the 10-min code default (which throttled
# throughput at low concurrency and delayed the stuck-job reaper).
SCRAPE_TIMEOUT_MS=${SCRAPE_TIMEOUT_MS:-240000}
# How far back the for-sale crawl looks, by LIST DATE (not activity). Emitted
# EXPLICITLY rather than left to the passthrough filter — SCRAPER_URLS was once
# silently swallowed by a prefix match in that filter and the crawl died for ten
# hours, so anything the crawl depends on is stated here where it is visible.
#
# 30 was the historical hardcoded value and is the safe default. It also means
# the crawl only ever sees property LISTED in the last 30 days: measured, ZIP
# 33020 returns 567 listings unfiltered against 89 at 30 days, so ~16% of
# available inventory. Empty string = no filter (see _env_past_days in
# services/scraper_service/main.py). Widen in stages and watch the rent queue.
# NOTE the single dash: ${VAR-default}, not ${VAR:-default}. With :- an
# explicitly EMPTY value would be rewritten back to 30, making the "no filter"
# setting silently impossible to express. With - an empty value survives.
SCRAPE_PAST_DAYS=${SCRAPE_PAST_DAYS-30}
# Anti-block pacing: min gap between job starts (~old schedule tick), jitter
# between a ZIP's passes, and the initial block cool-off (doubles per block).
CRAWL_JOB_MIN_INTERVAL_MS=${CRAWL_JOB_MIN_INTERVAL_MS:-30000}
CRAWL_PASS_JITTER_MS=${CRAWL_PASS_JITTER_MS:-1500}
CRAWL_BLOCK_COOLOFF_MS=${CRAWL_BLOCK_COOLOFF_MS:-1800000}
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

# --- Pass through every other key from .env ---
# Deny-list, not allow-list: the original allow-list silently dropped
# AUTH_SECRET, STRIPE_*, ADMIN_API_KEY, HUD/FRED/TELEGRAM tokens after the
# systemd cutover (2026-07-10 incident: login + billing ran without
# secrets). Anything not already rewritten above flows through verbatim.
$(grep -E '^[A-Z][A-Z0-9_]*=' "$SRC" | grep -vE '^(DATABASE_URL|DATABASE_URL_DIRECT|REDIS_URL|ML_URL|SCRAPER_URL|SCRAPER_URLS|POSTGRES_PASSWORD|REDIS_PASSWORD|NODE_ENV|ML_PORT|PYTHONPATH|WORKER_CONCURRENCY|SCRAPE_TIMEOUT_MS|CRAWL_JOB_MIN_INTERVAL_MS|CRAWL_PASS_JITTER_MS|CRAWL_BLOCK_COOLOFF_MS|RENT_BACKFILL_BATCH|RENT_WORKER_CONCURRENCY|RENT_DRAIN_INTERVAL_MS|CLUSTER_REFRESH_INTERVAL_MS|MEDIA_HEALTH_CONCURRENCY|MEDIA_HEALTH_INTERVAL_MS|WATCHLIST_TICK_MS|WATCHLIST_FROM_EMAIL|LOG_LEVEL|N8N_|DB_TYPE|DB_POSTGRESDB_|WEBHOOK_URL|GENERIC_TIMEZONE)' || true)
EOF

chmod 600 "$DST"
echo "Generated $DST ($(wc -l < "$DST") lines)"

# --- Per-service DB role env files (A3, backend-db-hardening) -------------
# Each service unit layers EnvironmentFile=-/etc/oper-role-<svc>.env AFTER
# /etc/oper.env, overriding DATABASE_URL with its least-privilege role.
# Passwords come from OPER_*_DB_PASSWORD in .env; when absent (roles not
# provisioned yet) the file is skipped and the service keeps the default
# superuser URL — the cutover is opt-in per secret.
write_role_env() {
  local svc="$1" role="$2" pass="$3"
  local dst="/etc/oper-role-${svc}.env"
  if [[ -z "$pass" ]]; then
    rm -f "$dst"
    return
  fi
  # Same cutover rule as the main env: DATABASE_URL follows the verified
  # DB_PORT (:6432 pooled / :5432 direct), DATABASE_URL_DIRECT is always :5432.
  # Every one of these roles is in the PgBouncer userlist (gen-pgbouncer-userlist.sh).
  printf '# Auto-generated by gen-env.sh — do not edit.\nDATABASE_URL=postgresql://%s:%s@localhost:%s/postgres\nDATABASE_URL_DIRECT=postgresql://%s:%s@localhost:5432/postgres\n' "$role" "$(urlencode "$pass")" "$DB_PORT" "$role" "$(urlencode "$pass")" > "$dst"
  chmod 600 "$dst"
}
write_role_env app      oper_app      "${OPER_APP_DB_PASSWORD:-}"
write_role_env worker   oper_worker   "${OPER_WORKER_DB_PASSWORD:-}"
write_role_env ml       oper_ml      "${OPER_ML_DB_PASSWORD:-}"
write_role_env tileserv oper_tileserv "${OPER_TILESERV_DB_PASSWORD:-}"
echo "Role env files refreshed (present: $(ls /etc/oper-role-*.env 2>/dev/null | wc -l))"
