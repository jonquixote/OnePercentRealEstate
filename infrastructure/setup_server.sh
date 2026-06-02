#!/bin/bash
set -euo pipefail

# ============================================================
# OnePercentRealEstate — Server Setup & Deploy
# Target: Ubuntu 24.04 LTS (Linode Dedicated 16GB or similar)
# Usage:  REMOTE_HOST=<ip> REMOTE_USER=root ./setup_server.sh
#         ./setup_server.sh <host> [user]
# ============================================================

REMOTE_HOST="${1:-${REMOTE_HOST:-}}"
REMOTE_USER="${2:-${REMOTE_USER:-root}}"
REMOTE_DIR="${REMOTE_DIR:-/opt/onepercent}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
SSH_PORT="${SSH_PORT:-22}"

if [[ -z "$REMOTE_HOST" ]]; then
  echo "ERROR: REMOTE_HOST is required."
  echo "  Usage: REMOTE_HOST=1.2.3.4 REMOTE_USER=root $0"
  exit 1
fi

if [[ -n "${REMOTE_PASSWORD:-}" ]]; then
  echo "WARNING: REMOTE_PASSWORD is set but SSH key auth is required for security."
  echo "  Set up passwordless SSH first: ssh-copy-id $REMOTE_USER@$REMOTE_HOST"
  exit 1
fi

SSH_TARGET="$REMOTE_USER@$REMOTE_HOST"
SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

log() { echo -e "\033[1;36m[setup]\033[0m $*"; }
die() { echo -e "\033[1;31m[error]\033[0m $*" >&2; exit 1; }

log "Target: $SSH_TARGET  Dir: $REMOTE_DIR"

# 0. Verify SSH access
log "Verifying SSH access..."
if ! ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "echo ok" >/dev/null 2>&1; then
  die "Cannot SSH to $SSH_TARGET. Set up keys first: ssh-copy-id $SSH_TARGET"
fi

# 1. System update + base packages
log "Updating system and installing base packages..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl wget git rsync ufw fail2ban htop vnstat jq net-tools unzip"

# 2. Configure firewall
log "Configuring ufw firewall (allow $SSH_PORT, 80, 443, 3001)..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow $SSH_PORT/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 3001/tcp comment 'Next.js app (direct, when not behind reverse proxy)'
  ufw --force enable
  ufw status verbose
"

# 3. Configure swap (4GB default — critical for 16GB servers under load)
log "Configuring ${SWAP_SIZE_GB}GB swap file..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  if ! swapon --show | grep -q '/swapfile'; then
    fallocate -l ${SWAP_SIZE_GB}G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_SIZE_GB * 1024)) status=none
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'vm.swappiness=10' >> /etc/sysctl.d/99-swap.conf
    sysctl -p /etc/sysctl.d/99-swap.conf
  fi
  free -h
"

# 4. Kernel tuning for Postgres + network
log "Tuning kernel parameters..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cat > /etc/sysctl.d/99-onepercent.conf <<EOF
# Network
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
# Postgres-friendly
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5
vm.zone_reclaim_mode = 0
# File handles
fs.file-max = 2097152
fs.nr_open = 1048576
EOF
sysctl --system"

# 5. Increase file descriptor limits
log "Setting file descriptor limits..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cat > /etc/security/limits.d/99-onepercent.conf <<EOF
* soft nofile 65536
* hard nofile 65536
root soft nofile 65536
root hard nofile 65536
EOF
echo 'fs.file-max = 2097152' >> /etc/sysctl.d/99-onepercent.conf"

# 6. Install Docker + Compose plugin
log "Installing Docker Engine + Compose plugin..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    systemctl enable --now docker
  fi
  docker --version
  docker compose version
"

# 7. Configure Docker daemon
log "Configuring Docker daemon (log rotation, userland-proxy off)..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cat > /etc/docker/daemon.json <<EOF
{
  \"log-driver\": \"json-file\",
  \"log-opts\": {
    \"max-size\": \"10m\",
    \"max-file\": \"3\"
  },
  \"userland-proxy\": false,
  \"storage-driver\": \"overlay2\",
  \"live-restore\": true
}
EOF
systemctl restart docker
docker info | grep -E 'Storage|Logging|Cgroup' || true
"

# 8. Create deploy directory
log "Preparing remote directory $REMOTE_DIR..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p $REMOTE_DIR/init-scripts"

# 9. Sync project files
log "Syncing project files (this may take a few minutes)..."
RSYNC_EXCLUDES=(
  --exclude='node_modules'
  --exclude='.git'
  --exclude='.next'
  --exclude='venv'
  --exclude='.venv'
  --exclude='env'
  --exclude='__pycache__'
  --exclude='*.pyc'
  --exclude='*.exp'
  --exclude='.DS_Store'
  --exclude='.env*'
  --exclude='plans/'
)
rsync -av --delete "${RSYNC_EXCLUDES[@]}" \
  "$(dirname "$0")/../" "$SSH_TARGET:$REMOTE_DIR/"

# 10. .env file
log "Setting up .env file..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  if [[ ! -f $REMOTE_DIR/.env ]]; then
    if [[ -f $REMOTE_DIR/.env.example ]]; then
      cp $REMOTE_DIR/.env.example $REMOTE_DIR/.env
      echo 'Created .env from .env.example. EDIT IT with real values:'
      echo \"  ssh $SSH_TARGET nano $REMOTE_DIR/.env\"
    else
      die '.env.example not found — cannot create .env'
    fi
  else
    echo '.env already exists, leaving it alone'
  fi
"

# 11. Run SQL migrations (idempotent)
log "Running SQL migrations..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  cd $REMOTE_DIR
  for f in infrastructure/migrations/*.sql; do
    [[ -f \"\$f\" ]] || continue
    echo \"  Applying \$f...\"
    PGPASSWORD=\"\$POSTGRES_PASSWORD\" psql -h 127.0.0.1 -U postgres -d postgres -f \"\$f\" 2>&1 | head -5 || echo '  (psql not reachable yet — will run after first container start)'
  done
"

# 12. Start the stack
log "Building and starting Docker stack..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  cd $REMOTE_DIR
  docker compose -f infrastructure/docker-compose.yml pull
  docker compose -f infrastructure/docker-compose.yml up -d --build
  docker compose -f infrastructure/docker-compose.yml ps
"

# 13. Wait for healthchecks
log "Waiting for services to become healthy (up to 120s)..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  cd $REMOTE_DIR
  for i in {1..24}; do
    sleep 5
    UNHEALTHY=\$(docker compose -f infrastructure/docker-compose.yml ps --format json 2>/dev/null | jq -r 'select(.Health != \"\" and .Health != \"healthy\") | .Service' 2>/dev/null | wc -l)
    if [[ \"\$UNHEALTHY\" -eq 0 ]]; then
      echo 'All services healthy.'
      break
    fi
    echo \"  Waiting... (\$i/24) — \$UNHEALTHY services not yet healthy\"
  done
"

# 14. Run SQL migrations against the live DB
log "Applying SQL migrations against live database..."
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "
  cd $REMOTE_DIR
  POSTGRES_PASSWORD=\$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
  for f in infrastructure/migrations/*.sql; do
    [[ -f \"\$f\" ]] || continue
    echo \"  Applying \$f...\"
    docker compose -f infrastructure/docker-compose.yml exec -T postgres \
      psql -U postgres -d postgres -f - < \"\$f\" 2>&1 | tail -3
  done
"

# 15. Final report
log "Setup complete!"
cat <<EOF

========================================
  OnePercentRealEstate deployed
========================================
  Server:   $REMOTE_HOST
  Directory: $REMOTE_DIR
  App port: 3001 (direct) or behind your reverse proxy on 80/443
  Health:   curl http://$REMOTE_HOST:3001/api/healthz

  Useful commands (ssh $SSH_TARGET first):
    cd $REMOTE_DIR
    docker compose -f infrastructure/docker-compose.yml ps
    docker compose -f infrastructure/docker-compose.yml logs -f app
    docker compose -f infrastructure/docker-compose.yml exec postgres psql -U postgres

  Next steps:
    1. Edit .env with real API keys:  nano $REMOTE_DIR/.env
    2. Configure reverse proxy (nginx-proxy-manager, Caddy, etc.) to expose port 3001
    3. Set up backups — see documentation/operations/backup-restore.md
    4. Verify healthcheck returns ok:  curl http://$REMOTE_HOST:3001/api/healthz
EOF
