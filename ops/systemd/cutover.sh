#!/bin/bash
# P4 Cutover Script — migrate ONE Docker service to systemd at a time.
#
# Usage:
#   ./cutover.sh postgres     # cut over postgres (includes data migration!)
#   ./cutover.sh ml           # cut over ML service
#   ./cutover.sh rollback ml  # roll back ML to Docker
#
# IMPORTANT: Run install.sh first to install packages and generate /etc/oper.env.
#
# The script:
#   1. For postgres/redis: dumps data from Docker container first
#   2. Stops the Docker container
#   3. For postgres/redis: restores data into native service
#   4. Enables and starts the systemd unit
#   5. Runs a health check
#   6. Reports status
#
# If health fails, run:  ./cutover.sh rollback <service>

set -euo pipefail
cd "$(dirname "$0")/../.."

source .env

COMPOSE_FILE="infrastructure/docker-compose.yml"

declare -A DOCKER_NAMES=(
  [postgres]="postgres"
  [redis]="redis"
  [ml]="ml"
  [app]="app"
  [two]="two"
  [scraper]="scraper"
  [pg_tileserv]="pg_tileserv"
  [n8n]="n8n"
  [worker]="worker"
  [worker-rent]="worker-rent"
  [worker-refresh]="worker-refresh"
  [worker-watchlist]="worker-watchlist-alerts"
  [worker-media]="worker-media-health"
  [worker-ml-scheduler]="worker-ml-scheduler"
)

declare -A SYSTEMD_UNITS=(
  [postgres]="oper-postgres"
  [redis]="oper-redis"
  [ml]="oper-ml"
  [app]="oper-app"
  [two]="oper-two"
  [scraper]="oper-scraper"
  [pg_tileserv]="oper-pg-tileserv"
  [n8n]="oper-n8n"
  [worker]="oper-worker"
  [worker-rent]="oper-worker-rent"
  [worker-refresh]="oper-worker-refresh"
  [worker-watchlist]="oper-worker-watchlist"
  [worker-media]="oper-worker-media"
  [worker-ml-scheduler]="oper-worker-ml-scheduler"
)

declare -A HEALTH_CHECKS=(
  [postgres]="pg_isready -h localhost -p 5432"
  [redis]="redis-cli -a ${REDIS_PASSWORD} ping 2>/dev/null | grep -q PONG"
  [ml]="curl -sf http://localhost:8000/healthz"
  [app]="curl -sf http://localhost:3000/ -o /dev/null"
  [two]="curl -sf http://localhost:3002/ -o /dev/null"
  [pg_tileserv]="curl -sf http://localhost:7800/ -o /dev/null"
)

rollback() {
  local svc="$1"
  local unit="${SYSTEMD_UNITS[$svc]}"
  local docker_name="${DOCKER_NAMES[$svc]}"
  echo "=== Rolling back $svc: systemd → Docker ==="
  systemctl stop "$unit" 2>/dev/null || true
  systemctl disable "$unit" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" up -d "$docker_name"
  echo "✓ $svc rolled back to Docker"
}

cutover_postgres() {
  echo "=== Cutting over POSTGRES (with data migration) ==="

  # 1. Stop all writers first
  echo "  [1/6] Stopping all workers to freeze writes..."
  for w in worker worker-rent worker-refresh worker-watchlist-alerts worker-media-health worker-ml-scheduler; do
    docker compose -f "$COMPOSE_FILE" stop "$w" 2>/dev/null || true
  done

  # 2. Dump from Docker container
  echo "  [2/6] Dumping database from Docker container..."
  docker exec -t infrastructure-postgres-1 pg_dumpall -U postgres > /root/onepercent_full_backup.sql
  DUMP_SIZE=$(du -h /root/onepercent_full_backup.sql | cut -f1)
  echo "    → Dump: /root/onepercent_full_backup.sql ($DUMP_SIZE)"

  # 3. Stop Docker postgres
  echo "  [3/6] Stopping Docker postgres..."
  docker compose -f "$COMPOSE_FILE" stop postgres

  # 4. Configure native postgres for password auth
  echo "  [4/6] Configuring native Postgres..."
  # Set password in pg_hba.conf for local connections
  PG_HBA="/etc/postgresql/16/main/pg_hba.conf"
  if [[ -f "$PG_HBA" ]]; then
    # Allow password auth for local TCP connections
    sed -i 's/^host\s\+all\s\+all\s\+127.0.0.1\/32\s\+.*$/host    all             all             127.0.0.1\/32            md5/' "$PG_HBA"
    sed -i 's/^host\s\+all\s\+all\s\+::1\/128\s\+.*$/host    all             all             ::1\/128                 md5/' "$PG_HBA"
  fi
  # Set shared_buffers to match Docker's allocation
  PG_CONF="/etc/postgresql/16/main/postgresql.conf"
  if ! grep -q "shared_buffers = 2GB" "$PG_CONF"; then
    echo "shared_buffers = 2GB" >> "$PG_CONF"
    echo "work_mem = 64MB" >> "$PG_CONF"
    echo "maintenance_work_mem = 512MB" >> "$PG_CONF"
    echo "listen_addresses = 'localhost'" >> "$PG_CONF"
  fi

  # 5. Start native postgres and restore
  echo "  [5/6] Starting native Postgres and restoring dump..."
  systemctl enable --now oper-postgres.service
  sleep 3

  # Set the postgres password
  sudo -u postgres psql -c "ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';"
  # Enable PostGIS
  sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true

  # Restore the dump
  sudo -u postgres psql < /root/onepercent_full_backup.sql 2>&1 | tail -5
  echo "    → Restore complete"

  # 6. Health check
  echo "  [6/6] Health check..."
  if pg_isready -h localhost -p 5432; then
    ROW_COUNT=$(sudo -u postgres psql -t -c "SELECT count(*) FROM rental_listings;" 2>/dev/null || echo "?")
    echo "  ✓ Postgres is healthy (rental_listings rows: $ROW_COUNT)"
  else
    echo "  ✗ Postgres health check FAILED"
    exit 1
  fi
  echo "=== Postgres successfully migrated ==="
}

cutover_redis() {
  echo "=== Cutting over REDIS (with data migration) ==="

  # 1. Force Redis to dump to disk
  echo "  [1/4] Saving Redis snapshot from Docker..."
  docker exec -t infrastructure-redis-1 redis-cli -a "${REDIS_PASSWORD}" SAVE 2>/dev/null

  # 2. Copy snapshot to native Redis data dir
  echo "  [2/4] Copying dump.rdb..."
  docker cp infrastructure-redis-1:/data/dump.rdb /var/lib/redis/dump.rdb 2>/dev/null || true
  chown redis:redis /var/lib/redis/dump.rdb 2>/dev/null || true

  # 3. Stop Docker redis, start native
  echo "  [3/4] Stopping Docker redis, starting native..."
  docker compose -f "$COMPOSE_FILE" stop redis
  systemctl enable --now oper-redis.service
  sleep 2

  # 4. Health check
  echo "  [4/4] Health check..."
  if redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
    echo "  ✓ Redis is healthy"
  else
    echo "  ✗ Redis health check FAILED — rolling back"
    rollback redis
    exit 1
  fi
  echo "=== Redis successfully migrated ==="
}

cutover_generic() {
  local svc="$1"
  local unit="${SYSTEMD_UNITS[$svc]}"
  local docker_name="${DOCKER_NAMES[$svc]}"

  echo "=== Cutting over $svc: Docker → systemd ==="

  # 1. Stop Docker container
  echo "  [1/3] Stopping Docker container: $docker_name"
  docker compose -f "$COMPOSE_FILE" stop "$docker_name"

  # 2. Enable + start systemd unit
  echo "  [2/3] Enabling systemd unit: $unit"
  systemctl enable --now "$unit"
  sleep 3

  # 3. Health check
  local check="${HEALTH_CHECKS[$svc]:-}"
  if [[ -n "$check" ]]; then
    echo "  [3/3] Running health check..."
    if eval "$check" 2>/dev/null; then
      echo "  ✓ Health check passed"
    else
      echo "  ✗ Health check FAILED — rolling back!"
      rollback "$svc"
      exit 1
    fi
  else
    echo "  [3/3] Checking systemd status..."
    if systemctl is-active --quiet "$unit"; then
      echo "  ✓ Unit is active"
    else
      echo "  ✗ Unit not active — rolling back!"
      rollback "$svc"
      exit 1
    fi
  fi

  systemctl status "$unit" --no-pager -l | head -8
  echo ""
  echo "=== $svc successfully migrated to systemd ==="
}

# --- Main ---
if [[ $# -eq 0 ]]; then
  echo "Usage:"
  echo "  $0 <service>           # cut over a service"
  echo "  $0 rollback <service>  # roll back to Docker"
  echo ""
  echo "Available services: ${!DOCKER_NAMES[*]}"
  echo ""
  echo "Recommended order:"
  echo "  1. postgres  (data migration — dumps and restores)"
  echo "  2. redis     (data migration — copies dump.rdb)"
  echo "  3. ml"
  echo "  4. scraper"
  echo "  5. worker worker-rent worker-refresh worker-watchlist worker-media worker-ml-scheduler"
  echo "  6. app two"
  echo "  7. pg_tileserv n8n"
  exit 0
fi

if [[ "$1" == "rollback" ]]; then
  [[ $# -lt 2 ]] && { echo "Usage: $0 rollback <service>"; exit 1; }
  rollback "$2"
elif [[ "$1" == "postgres" ]]; then
  cutover_postgres
elif [[ "$1" == "redis" ]]; then
  cutover_redis
else
  cutover_generic "$1"
fi
