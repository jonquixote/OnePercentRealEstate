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
  oper-worker-digest oper-worker-alerts
  oper-healthcheck
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
  [worker-digest]="oper-worker-digest"
  [worker-alerts]="oper-worker-alerts"
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
  echo "--- Building Node.js (pnpm) under memory cap ---"
  # NEXT_PUBLIC_* vars are baked into the client bundle AT BUILD TIME —
  # without sourcing .env here, Stripe's publishable key (and any other
  # NEXT_PUBLIC config) ships as undefined.
  # systemd-run --scope creates a transient cgroup so a runaway build is
  # reclaimed/killed instead of OOMing the live stack.
  systemd-run --scope \
    -p MemoryMax=6G -p MemoryHigh=5G -p Nice=10 -p IOWeight=50 \
    bash -c '
      set -euo pipefail
      set -a
      . ./.env
      set +a
      pnpm install --frozen-lockfile
      pnpm build

      # Copy static assets into standalone directories (required for Next.js standalone mode).
      for app in one two; do
        src="apps/$app/.next/static"
        dst="apps/$app/.next/standalone/apps/$app/.next/static"
        if [[ -d "$src" ]]; then
          echo "  Copying static assets: $src -> $dst"
          rm -rf "$dst"
          mkdir -p "$dst"
          cp -a "$src/." "$dst/"
        fi
        pub="apps/$app/public"
        pubdst="apps/$app/.next/standalone/apps/$app/public"
        if [[ -d "$pub" ]]; then
          echo "  Copying public assets: $pub -> $pubdst"
          rm -rf "$pubdst"
          mkdir -p "$pubdst"
          cp -a "$pub/." "$pubdst/"
        fi
      done
    '
}

build_ml() {
  echo "--- Installing ML Python deps ---"
  services/ml/.venv/bin/pip install -q -r services/ml/requirements.txt
}

# Post-deploy smoke gate — fail-closed. Any failure = non-zero exit.
smoke_test() {
  echo "--- Running post-deploy smoke tests ---"
  local failed=0
  local notify_script="$(dirname "$0")/../monitoring/notify-telegram.sh"
  local box=$(hostname)

  fail() {
    local check="$1"
    local detail="$2"
    echo "  SMOKE FAIL: ${check} — ${detail}"
    if [[ -x "$notify_script" ]]; then
      "$notify_script" --key "smoke-${check}" "RED ${box}: deploy smoke failed — ${check}: ${detail}"
    fi
    failed=1
  }

  pass() {
    local check="$1"
    echo "  SMOKE PASS: ${check}"
    if [[ -x "$notify_script" ]]; then
      "$notify_script" --resolved --key "smoke-${check}" "OK ${box}: deploy smoke passed — ${check}"
    fi
  }

  # 1. HTTP health endpoint
  local health_resp
  if health_resp=$(curl -sf -m5 http://127.0.0.1:3001/api/health 2>/dev/null); then
    if echo "$health_resp" | grep -q '"status":"ok"'; then
      pass "health"
    else
      fail "health" "status not ok: ${health_resp}"
    fi
  else
    fail "health" "curl failed"
  fi

  # 2. /sitemap.xml — must be XML with <urlset
  local sitemap_ct sitemap_body
  sitemap_ct=$(curl -sf -m5 -o /dev/null -w '%{content_type}' http://127.0.0.1:3001/sitemap.xml 2>/dev/null || echo "")
  sitemap_body=$(curl -sf -m5 http://127.0.0.1:3001/sitemap.xml 2>/dev/null | head -5 || echo "")
  if echo "$sitemap_ct" | grep -qi 'xml' && echo "$sitemap_body" | grep -q '<urlset'; then
    pass "sitemap"
  else
    fail "sitemap" "content-type=${sitemap_ct}, body snippet: ${sitemap_body:0:100}"
  fi

  # 3. /robots.txt — 200 with Disallow
  local robots_body
  robots_body=$(curl -sf -m5 http://127.0.0.1:3001/robots.txt 2>/dev/null || echo "")
  if echo "$robots_body" | grep -q 'Disallow'; then
    pass "robots"
  else
    fail "robots" "missing Disallow directive"
  fi

  # 4. oper-two / — 200
  if curl -sf -m5 http://127.0.0.1:3002/ >/dev/null 2>&1; then
    pass "oper-two"
  else
    fail "oper-two" "curl to port 3002 failed"
  fi

  echo ""
  if [[ $failed -ne 0 ]]; then
    echo "=== SMOKE GATE FAILED — deploy marked failed (non-zero exit) ==="
    echo "Fix the failing checks and re-deploy."
    exit 1
  fi
  echo "=== Smoke tests passed ==="
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

smoke_test
