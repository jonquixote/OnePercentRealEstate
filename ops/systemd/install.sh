#!/bin/bash
# P4 Systemd Units — Install + Setup Script
#
# Installs native packages, configures Redis password, generates
# /etc/oper.env, and copies systemd unit files.
#
# Run as root on the VPS AFTER freezing a known-good ML artifact.
#
# Usage:
#   ssh root@209.94.61.108
#   bash /opt/onepercent/ops/systemd/install.sh

set -euo pipefail

PROJECT_ROOT="/opt/onepercent"
ENV_FILE="${PROJECT_ROOT}/.env"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== P4 systemd migration setup ==="

# ── Step 0: Source env ──────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi
set -a
. "$ENV_FILE"
set +a

# ── Step 1: Install native Postgres 16 with PostGIS ─────────────────
echo "--- [1/7] Installing PostgreSQL 16 + PostGIS ---"
apt-get update -qq
apt-get install -y curl gnupg lsb-release

curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg 2>/dev/null || true
echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y postgresql-16 postgresql-16-postgis-3 libpq-dev
# Don't auto-start — we'll cut over manually
systemctl disable postgresql 2>/dev/null || true
systemctl stop postgresql 2>/dev/null || true

# ── Step 2: Install Redis ────────────────────────────────────────────
echo "--- [2/7] Installing Redis ---"
apt-get install -y redis-server
# Don't auto-start
systemctl disable redis-server 2>/dev/null || true
systemctl stop redis-server 2>/dev/null || true

# Configure Redis password in redis.conf (systemd can't expand env vars
# in ExecStart, so the password MUST be in the config file).
if ! grep -q "^requirepass " /etc/redis/redis.conf; then
  echo "requirepass ${REDIS_PASSWORD}" >> /etc/redis/redis.conf
  echo "  → Set requirepass in /etc/redis/redis.conf"
else
  sed -i "s/^requirepass .*/requirepass ${REDIS_PASSWORD}/" /etc/redis/redis.conf
  echo "  → Updated requirepass in /etc/redis/redis.conf"
fi
# Bind to localhost only
sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf

# ── Step 3: Install Node.js 22 LTS ──────────────────────────────────
echo "--- [3/7] Installing Node.js 22 ---"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
fi
echo "  node $(node --version), pnpm $(pnpm --version)"

# ── Step 4: Install Python 3 + venv ─────────────────────────────────
echo "--- [4/7] Installing Python 3 + ML venv ---"
apt-get install -y python3 python3-pip python3-venv

if [[ ! -d "${PROJECT_ROOT}/services/ml/.venv" ]]; then
  python3 -m venv "${PROJECT_ROOT}/services/ml/.venv"
fi
"${PROJECT_ROOT}/services/ml/.venv/bin/pip" install -q \
  -r "${PROJECT_ROOT}/services/ml/requirements.txt"

# ── Step 5: Install pg_tileserv ──────────────────────────────────────
echo "--- [5/7] Installing pg_tileserv ---"
if [[ ! -f /usr/local/bin/pg_tileserv ]]; then
  echo "Extracting pg_tileserv binary from running Docker container..."
  docker cp infrastructure-pg_tileserv-1:/usr/bin/pg_tileserv /usr/local/bin/pg_tileserv || \
  docker cp infrastructure-pg_tileserv-1:/usr/local/bin/pg_tileserv /usr/local/bin/pg_tileserv || \
  docker cp infrastructure-pg_tileserv-1:/pg_tileserv /usr/local/bin/pg_tileserv
  chmod +x /usr/local/bin/pg_tileserv
fi

# ── Step 6: Generate /etc/oper.env ───────────────────────────────────
echo "--- [6/7] Generating /etc/oper.env ---"
bash "${SCRIPT_DIR}/gen-env.sh"

# ── Step 7: Copy systemd unit files ─────────────────────────────────
echo "--- [7/7] Installing systemd unit files ---"
cp -v "${SCRIPT_DIR}/"oper-*.service /etc/systemd/system/
systemctl daemon-reload

echo ""
echo "=== Installation complete ==="
echo ""
echo "Installed units:"
ls -1 /etc/systemd/system/oper-*.service | sed 's|.*/|  |'
echo ""
echo "NEXT STEPS — cut over ONE service at a time:"
echo "  bash ${SCRIPT_DIR}/cutover.sh postgres"
echo "  bash ${SCRIPT_DIR}/cutover.sh redis"
echo "  bash ${SCRIPT_DIR}/cutover.sh ml"
echo "  ... etc (see cutover.sh for full list)"
