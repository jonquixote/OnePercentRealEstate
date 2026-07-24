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
  oper-healthcheck oper-snapshot oper-pg-stat.timer oper-pgbouncer
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
  [pgbouncer]="oper-pgbouncer"
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

# Preflight: validate the freshly-generated config against the RUNNING system
# before anything is built or restarted. Fail-closed — a bad config aborts here
# with nothing mutated, instead of half-deploying (2026-07-24: DATABASE_URL
# pointed at a PgBouncer port that did not exist and the app went down).
bash "$(dirname "$0")/../ci/preflight.sh" || {
  echo "Deploy aborted by preflight." >&2
  exit 1
}

# Recorded before the build so we can prove the build actually rebuilt and the
# units actually restarted (an invalid systemd-run property once made the build
# a silent no-op while the deploy still reported success).
DEPLOY_START_EPOCH=$(date +%s)

# Build steps
build_node() {
  echo "--- Building Node.js (pnpm) under memory cap ---"
  # NEXT_PUBLIC_* vars are baked into the client bundle AT BUILD TIME —
  # without sourcing .env here, Stripe's publishable key (and any other
  # NEXT_PUBLIC config) ships as undefined.
  # systemd-run --scope creates a transient cgroup so a runaway build is
  # reclaimed/killed instead of OOMing the live stack. Only cgroup memory
  # properties are valid on a scope — `-p Nice=`/`-p IOWeight=` are rejected
  # ("Unknown assignment: Nice=10") and abort the whole deploy, so priority is
  # applied by wrapping the command in nice/ionice instead.
  systemd-run --scope \
    -p MemoryMax=6G -p MemoryHigh=5G \
    nice -n 10 ionice -c2 -n5 \
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

# Assert the build produced fresh output and the units really restarted.
# The 2026-07-24 `-p Nice=10` bug made build_node abort silently: the deploy
# printed "Deploy complete" while the app kept running hours-old code. Freshness
# is checked against DEPLOY_START_EPOCH, so a no-op build cannot pass.
assert_rebuilt_and_restarted() {
  local -a units=("$@")
  local problem=0
  echo "--- Verifying build output + restarts are fresh ---"

  # a) the standalone bundles must EXIST.
  #    Deliberately NOT an mtime-vs-deploy-start check: turbo caches the build,
  #    so an unchanged app legitimately does not rewrite server.js and a
  #    freshness assertion false-positives on every no-source-change deploy.
  #    A build that truly produced nothing is caught here; a build that ABORTED
  #    is already caught by `set -e` (it exits before reaching the restarts,
  #    which check (b) then proves did not happen).
  for app in one two; do
    local server_js="apps/$app/.next/standalone/apps/$app/server.js"
    if [[ -f "$server_js" ]]; then
      echo "  bundle present: $server_js"
    else
      echo "  MISSING bundle: $server_js — the build produced no server output" >&2
      problem=1
    fi
  done

  # b) every restarted unit must have entered active AFTER the deploy started
  for u in "${units[@]}"; do
    systemctl is-active --quiet "$u" 2>/dev/null || continue
    local ts epoch
    ts=$(systemctl show "$u" -p ActiveEnterTimestamp --value 2>/dev/null)
    [[ -z "$ts" ]] && continue
    epoch=$(date -d "$ts" +%s 2>/dev/null || echo 0)
    if [[ "$epoch" -ge "$DEPLOY_START_EPOCH" ]]; then
      echo "  restarted: $u"
    else
      echo "  NOT RESTARTED: $u still running from before this deploy" >&2
      problem=1
    fi
  done

  if [[ $problem -ne 0 ]]; then
    local notify_script="$(dirname "$0")/../monitoring/notify-telegram.sh"
    [[ -x "$notify_script" ]] && "$notify_script" --key "deploy-noop" \
      "RED $(hostname): deploy produced a stale build or did not restart units" || true
    echo ""
    echo "=== DEPLOY VERIFICATION FAILED (silent no-op build/restart) ===" >&2
    exit 1
  fi
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
    # Telegram outage must not fail an otherwise-healthy deploy.
    if [[ -x "$notify_script" ]]; then
      "$notify_script" --key "smoke-${check}" "RED ${box}: deploy smoke failed — ${check}: ${detail}" \
        || echo "WARN: failed to send smoke alert for ${check}" >&2
    fi
    failed=1
  }

  pass() {
    local check="$1"
    echo "  SMOKE PASS: ${check}"
    if [[ -x "$notify_script" ]]; then
      "$notify_script" --resolved --key "smoke-${check}" "OK ${box}: deploy smoke passed — ${check}" \
        || echo "WARN: failed to send smoke resolution for ${check}" >&2
    fi
  }

  # Wait for the app to accept connections after restart — a cold curl races
  # Next standalone's startup and gives a spurious "health curl failed".
  echo "  Waiting for oper-app to become ready..."
  for _i in $(seq 1 30); do
    curl -s -m3 -o /dev/null http://127.0.0.1:3001/api/health 2>/dev/null && break
    sleep 1
  done

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

  # 2. /sitemap.xml — must be XML with <urlset. Generous timeout: a cold-cache
  #    generation builds ~31k URLs from two large queries (~20s); it is cached
  #    for an hour after, but the first hit post-deploy pays the full cost.
  local sitemap_ct sitemap_body
  sitemap_ct=$(curl -sf -m45 -o /dev/null -w '%{content_type}' http://127.0.0.1:3001/sitemap.xml 2>/dev/null || echo "")
  sitemap_body=$(curl -sf -m45 http://127.0.0.1:3001/sitemap.xml 2>/dev/null | sed -n '1,5p' || echo "")
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

  # 4b. PgBouncer — only assert when the cutover is actually on (DATABASE_URL
  #     resolved to :6432). If the app is on direct :5432 this is not a failure.
  if grep -q '^DATABASE_URL=.*:6432/' /etc/oper.env 2>/dev/null; then
    if systemctl is-active --quiet oper-pgbouncer 2>/dev/null \
       && psql "$(grep '^DATABASE_URL=' /etc/oper.env | cut -d= -f2-)" -tAc 'SELECT 1' >/dev/null 2>&1; then
      pass "pgbouncer"
    else
      fail "pgbouncer" "DATABASE_URL points at :6432 but the pooler is not answering"
    fi
  fi

  # 5. scraper (FastAPI on port 8001) — REACHABLE. The root path has no route
  #    (404 is normal for FastAPI); "up" means the port answers HTTP at all, so
  #    accept any status code (curl without -f succeeds on 404). Only a
  #    connection failure (port down) is a real failure.
  if curl -s -m5 -o /dev/null http://127.0.0.1:8001/ 2>/dev/null; then
    pass "scraper"
  else
    fail "scraper" "port 8001 not answering"
  fi

  # 6. property page — known property has non-generic title
  local prop_title
  prop_title=$(curl -sf -m5 http://127.0.0.1:3001/property/1 2>/dev/null | grep -oP '<title>\K[^<]+' || echo "")
  if [[ -n "$prop_title" && "$prop_title" != *"Error"* && "$prop_title" != *"404"* && "$prop_title" != *"Not Found"* ]]; then
    pass "property-page"
  else
    fail "property-page" "property page title empty or generic: ${prop_title:0:60}"
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
  RESTARTED_UNITS=("${targets[@]}")
else
  # Full deploy
  build_node
  build_ml
  echo "--- Restarting all services ---"
  for u in "${ALL_UNITS[@]}"; do
    echo "  Restarting $u..."
    systemctl restart "$u"
  done
  RESTARTED_UNITS=("${ALL_UNITS[@]}")
fi

# Prove the build wrote fresh output and the units actually restarted, before
# the smoke gate runs. A silent no-op build fails HERE rather than shipping.
assert_rebuilt_and_restarted "${RESTARTED_UNITS[@]}"

echo ""
echo "=== Deploy complete ==="
"$0" status

smoke_test
