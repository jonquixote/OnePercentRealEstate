#!/bin/bash
# Systemd deploy wrapper — replaces Docker deploy.sh after P4 migration.
#
# Usage:
#   ./deploy-systemd.sh              # rebuild + restart all services
#   ./deploy-systemd.sh ml worker    # rebuild + restart specific services
#   ./deploy-systemd.sh status       # show status of all oper-* units

set -euo pipefail
cd "$(dirname "$0")/../.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in project root."
  exit 1
fi

ALL_UNITS=(
  oper-postgres oper-redis oper-ml oper-app oper-two oper-scraper
  oper-pg-tileserv oper-n8n
  oper-worker oper-worker-rent oper-worker-refresh
  oper-worker-watchlist oper-worker-media oper-worker-ml-scheduler
)

# Service name → systemd unit mapping
declare -A UNITS=(
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

if [[ "${1:-}" == "status" ]]; then
  for u in "${ALL_UNITS[@]}"; do
    systemctl is-active --quiet "$u" 2>/dev/null && s="●" || s="○"
    printf "  %s  %s\n" "$s" "$u"
  done
  exit 0
fi

# Regenerate /etc/oper.env from .env (picks up any password/config changes)
echo "--- Regenerating /etc/oper.env ---"
bash "$(dirname "$0")/gen-env.sh"

# Regenerate alertmanager runtime config from .env
echo "--- Regenerating alertmanager config ---"
bash "$(dirname "$0")/gen-alertmanager.sh"

# Build steps
build_node() {
  echo "--- Building Node.js (pnpm) ---"
  # NEXT_PUBLIC_* vars are baked into the client bundle AT BUILD TIME —
  # without sourcing .env here, Stripe's publishable key (and any other
  # NEXT_PUBLIC config) ships as undefined.
  set -a; . ./.env; set +a
  pnpm install --frozen-lockfile
  pnpm build

  # Copy static assets into standalone directories (required for Next.js standalone mode)
  for app in one two; do
    src="apps/$app/.next/static"
    dst="apps/$app/.next/standalone/apps/$app/.next/static"
    if [[ -d "$src" ]]; then
      echo "  Copying static assets: $src -> $dst"
      mkdir -p "$dst"
      cp -r "$src"/* "$dst"/
    fi
  done
}

build_ml() {
  echo "--- Installing ML Python deps ---"
  services/ml/.venv/bin/pip install -q -r services/ml/requirements.txt
}

# If specific services given, restart only those
if [[ $# -gt 0 ]]; then
  targets=()
  needs_node=false
  needs_ml=false
  for svc in "$@"; do
    unit="${UNITS[$svc]:-}"
    if [[ -z "$unit" ]]; then
      echo "Unknown service: $svc"
      echo "Available: ${!UNITS[*]}"
      exit 1
    fi
    targets+=("$unit")
    case "$svc" in
      app|two|worker*|n8n) needs_node=true ;;
      ml|scraper) needs_ml=true ;;
    esac
  done
  $needs_node && build_node
  $needs_ml && build_ml
  for u in "${targets[@]}"; do
    echo "Restarting $u..."
    systemctl restart "$u"
  done
else
  # Full deploy
  build_node
  build_ml
  echo "--- Restarting all services ---"
  for u in "${ALL_UNITS[@]}"; do
    echo "  Restarting $u..."
    systemctl restart "$u"
  done
fi

echo ""
echo "=== Deploy complete ==="
"$0" status
