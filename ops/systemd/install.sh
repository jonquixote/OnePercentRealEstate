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
# Don't auto-start — oper-postgres.service owns this PGDATA. Leaving the Debian
# cluster unit enabled means TWO units competing for /var/lib/postgresql/16/main.
systemctl disable --now postgresql postgresql@16-main 2>/dev/null || true
systemctl stop postgresql 2>/dev/null || true

# Performance tuning. Without this Postgres runs on stock defaults
# (shared_buffers 128MB, work_mem 4MB, random_page_cost 4.0 — a spinning-disk
# assumption), which on this workload is materially slower and makes the planner
# seq-scan an 11GB listings table. It also enables pg_stat_statements, which
# ops/monitoring/db-load-budget.sh REQUIRES — without it that probe just prints
# "query failed" and the one signal that has repeatedly caught slow-query
# regressions is silently dead.
#
# Values assume ~23GB RAM / 12 vCPU; re-derive shared_buffers (~25% RAM) and
# effective_cache_size (~75%) if the box differs.
install -m644 -o postgres -g postgres "${PROJECT_ROOT}/ops/db/postgresql-tuning.conf" \
  /etc/postgresql/16/main/conf.d/10-oper-tuning.conf
echo "  → Postgres tuning installed (restart required to take effect)"

# ── Step 2: Install Redis ────────────────────────────────────────────
echo "--- [2/7] Installing Redis ---"
apt-get install -y redis-server

# age — encrypts the secrets bundle in backup-postgres.sh. The recipient PUBLIC
# key is committed (ops/db/backup-age-recipient.pub); the private key is held
# off-box by the operator and is the only thing that can decrypt. Installing the
# pub key here lets the daily backup encrypt on a fresh box with no manual step.
apt-get install -y age
install -m644 "${PROJECT_ROOT}/ops/db/backup-age-recipient.pub" /etc/oper-backup-age.pub
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

# oper-redis.service runs redis in the FOREGROUND. Ubuntu's packaged redis.conf
# ships `daemonize yes`, so redis forked, the parent exited 0, and systemd
# recorded the unit as cleanly "inactive (dead)" 25ms after start — a silent
# no-op that looks like success. Force foreground + systemd notification.
sed -i 's/^daemonize .*/daemonize no/' /etc/redis/redis.conf
grep -q '^daemonize ' /etc/redis/redis.conf || echo 'daemonize no' >> /etc/redis/redis.conf
sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf

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
# Download from upstream. This used to `docker cp` the binary out of a running
# infrastructure-pg_tileserv-1 container — which only worked while the ORIGINAL
# Docker stack still existed on the box. Rebuilding on a fresh server (2026-07-31)
# there is no container and no Docker, so that step could never succeed and the
# installer silently produced a host with no tile server.
# Upstream (CrunchyData) publishes NO versioned release assets on GitHub — only
# a rolling `_latest_` archive on S3. Installing that unverified, as root, in an
# unattended installer is a supply-chain hole: whatever S3 serves that day gets
# mode 755 in /usr/local/bin.
#
# Since we cannot pin a version URL, we pin the CONTENT and fail closed. If the
# checksum does not match, the install ABORTS rather than trusting a changed
# artifact. When upstream legitimately publishes a new build this will trip on
# purpose — verify the new archive by hand, then update PGT_SHA256 below.
PGT_URL="https://postgisftw.s3.amazonaws.com/pg_tileserv_latest_linux.zip"
# Verified 2026-07-31 (upstream reported v1.0.11).
PGT_SHA256="38f95ab9fac1fe8d445e7caaa8547425ac3a720e1e157b1730e19212595d8a3e"

if [[ ! -f /usr/local/bin/pg_tileserv ]]; then
  echo "Downloading pg_tileserv..."
  apt-get install -y unzip
  _pgt_tmp="$(mktemp -d)"
  curl -sSL --proto '=https' --tlsv1.2 -m 120 -o "${_pgt_tmp}/pgt.zip" "$PGT_URL"

  _pgt_got="$(sha256sum "${_pgt_tmp}/pgt.zip" | awk '{print $1}')"
  if [[ "$_pgt_got" != "$PGT_SHA256" ]]; then
    rm -rf "${_pgt_tmp}"
    cat >&2 <<EOF
ERROR: pg_tileserv checksum mismatch — REFUSING to install.
  expected: $PGT_SHA256
  got:      $_pgt_got
Upstream ships a rolling "latest" archive, so this trips whenever they publish
a new build. Verify the new archive independently, then update PGT_SHA256 in
$(basename "$0"). Do not "fix" this by deleting the check.
EOF
    exit 1
  fi

  unzip -oq "${_pgt_tmp}/pgt.zip" -d "${_pgt_tmp}/pgt"
  find "${_pgt_tmp}/pgt" -name pg_tileserv -type f \
    -exec install -m755 {} /usr/local/bin/pg_tileserv \;
  # Bundled web assets — without them pg_tileserv answers 500 on every page.
  mkdir -p /usr/local/share/pg_tileserv
  [[ -d "${_pgt_tmp}/pgt/assets" ]] && cp -r "${_pgt_tmp}/pgt/assets" /usr/local/share/pg_tileserv/
  rm -rf "${_pgt_tmp}"
  /usr/local/bin/pg_tileserv --version || {
    echo "ERROR: pg_tileserv install failed" >&2; exit 1; }
fi

# ── Step 6: Generate /etc/oper.env ───────────────────────────────────
echo "--- [6/7] Generating /etc/oper.env ---"
bash "${SCRIPT_DIR}/gen-env.sh"

# ── Step 7: Copy systemd unit files ─────────────────────────────────
echo "--- [7/7] Installing systemd unit files ---"
cp -v "${SCRIPT_DIR}/"oper-*.service /etc/systemd/system/
cp -v "${SCRIPT_DIR}/"oper-*.timer /etc/systemd/system/
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
