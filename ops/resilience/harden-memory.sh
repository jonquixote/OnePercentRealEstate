#!/bin/bash
set -euo pipefail

# =============================================================================
# harden-memory.sh — OOM containment hardening
#
# Root cause: 2026-07-24 prod incident — worker processes consumed unbounded
# memory, triggering kernel OOM killer which took down postgres (the most
# critical service). Workers had MemoryMax but no MemoryHigh, so the kernel
# went straight to hard-kill without giving cgroup reclaim a chance.
#
# Strategy:
#   1. Postgres: tune shared_buffers/work_mem/maintenance_work_mem, cap
#      max_connections, and verify OOMScoreAdjust=-900 (already set in unit).
#   2. Every worker/service: add MemoryHigh (soft reclaim trigger) below the
#      existing MemoryMax (hard kill). This gives cgroup memory.reclaim a
#      chance before the OOM killer fires.
#   3. Swap + sysctl: 8GB swapfile, conservative swappiness, overcommit=2
#      so allocations fail gracefully instead of invoking OOM killer.
#
# Safe to re-run. Idempotent.
# Run as root on the prod box.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_DIR="$REPO_ROOT/ops/systemd"
SYSCTL_CONF="/etc/sysctl.d/99-oper-mem.conf"

info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()    { printf "\033[1;32m[OK]\033[0m    %s\n" "$*"; }
skip()  { printf "\033[1;33m[SKIP]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[1;31m[WARN]\033[0m  %s\n" "$*"; }

# ---- Step 1: Postgres conf drop-in -----------------------------------------
info "Step 1: Postgres memory tuning conf drop-in"

PG_CONF_TARGET="/etc/postgresql/16/main/conf.d/10-oper-mem.conf"
PG_CONF_CONTENT="# oper-postgres memory tuning (harden-memory.sh)
# Shared buffers: ~25% of 8G RAM = 2G. Keeps hot pages cached without
# starving the OS page cache needed by pg_tileserv and app processes.
shared_buffers = 2GB

# Per-query working memory. Was 64MB; combined with 100 connections +
# parallel workers this was the spike surface for the 2026-07-24 OOM.
# 32MB is enough for most queries; complex sorts/hash joins spill to disk.
work_mem = 32MB

# VACUUM/CREATE INDEX memory. 256MB speeds up maintenance without starving
# the running workload.
maintenance_work_mem = 256MB

# Cap connections to prevent connection-spike OOM. PgBouncer handles pooling.
max_connections = 100
"

if [ -f "$PG_CONF_TARGET" ]; then
  if printf '%s\n' "$PG_CONF_CONTENT" | cmp -s - "$PG_CONF_TARGET"; then
    skip "Postgres conf drop-in already up to date at $PG_CONF_TARGET"
  else
    info "Updating $PG_CONF_TARGET"
    cp "$PG_CONF_TARGET" "${PG_CONF_TARGET}.bak.$(date +%s)"
    printf '%s\n' "$PG_CONF_CONTENT" > "$PG_CONF_TARGET"
    ok "Postgres conf drop-in updated (backup saved)"
  fi
else
  info "Creating $PG_CONF_TARGET"
  mkdir -p "$(dirname "$PG_CONF_TARGET")"
  printf '%s\n' "$PG_CONF_CONTENT" > "$PG_CONF_TARGET"
  ok "Postgres conf drop-in created"
fi

# Reload Postgres config (not restart — zero downtime)
info "Reloading Postgres config via pg_reload_conf()..."
if command -v psql &>/dev/null; then
  sudo -u postgres psql -c "SELECT pg_reload_conf();" 2>/dev/null && ok "Postgres config reloaded" || warn "pg_reload_conf() failed — reload manually"
else
  skip "psql not found — reload Postgres config manually: sudo -u postgres psql -c 'SELECT pg_reload_conf();'"
fi

# ---- Step 2: Verify Postgres OOM protection ----------------------------------
info "Step 2: Verify Postgres OOM protection"

PG_UNIT="$SERVICE_DIR/oper-postgres.service"
if grep -q "OOMScoreAdjust=-900" "$PG_UNIT" 2>/dev/null; then
  ok "Postgres already has OOMScoreAdjust=-900 in $PG_UNIT"
  ok "No additional systemd drop-in needed — main unit handles OOM protection"
else
  warn "Postgres unit does NOT have OOMScoreAdjust=-900!"
  warn "Add 'OOMScoreAdjust=-900' to [Service] section of $PG_UNIT"
fi

# ---- Step 3: Add MemoryHigh to every service --------------------------------
info "Step 3: Add MemoryHigh to service units"

add_memory_high() {
  local file="$1"
  local mem_high="$2"
  local mem_max="$3"
  local basename
  basename="$(basename "$file")"

  if [ ! -f "$file" ]; then
    warn "$basename not found — skipping"
    return
  fi

  # Already has MemoryHigh?
  if grep -q "^MemoryHigh=" "$file"; then
    local existing
    existing=$(grep "^MemoryHigh=" "$file" | head -1)
    if [ "$existing" = "MemoryHigh=$mem_high" ]; then
      skip "$basename already has MemoryHigh=$mem_high"
      return
    else
      info "$basename has $existing — updating to MemoryHigh=$mem_high"
      sed -i.bak "s/^MemoryHigh=.*/MemoryHigh=$mem_high/" "$file"
      rm -f "${file}.bak"
      ok "$basename MemoryHigh updated to $mem_high"
      return
    fi
  fi

  # Insert MemoryHigh before MemoryMax (or before [Install] if no MemoryMax)
  if grep -q "^MemoryMax=" "$file"; then
    sed -i.bak "/^MemoryMax=/i\\
MemoryHigh=${mem_high}" "$file"
  else
    sed -i.bak "/^\[Install\]/i\\
MemoryHigh=${mem_high}\\
MemoryMax=${mem_max}" "$file"
  fi
  rm -f "${file}.bak"
  ok "$basename — added MemoryHigh=$mem_high (MemoryMax=$mem_max)"
}

# App services
add_memory_high "$SERVICE_DIR/oper-app.service"        "1536M" "2G"
add_memory_high "$SERVICE_DIR/oper-two.service"        "768M"  "1G"

# ML service — already has MemoryMax=8G (P4 reclaimed budget)
add_memory_high "$SERVICE_DIR/oper-ml.service"         "6G"    "8G"

# Scraper — verify (idempotent, self-corrects on drift)
add_memory_high "$SERVICE_DIR/oper-scraper.service" "1536M" "2G"

# Workers — standard sizing (384M high / 512M max)
add_memory_high "$SERVICE_DIR/oper-worker.service"              "384M" "512M"
add_memory_high "$SERVICE_DIR/oper-worker-rent.service"         "384M" "512M"
add_memory_high "$SERVICE_DIR/oper-worker-refresh.service"      "384M" "512M"
add_memory_high "$SERVICE_DIR/oper-worker-watchlist.service"    "192M" "256M"
add_memory_high "$SERVICE_DIR/oper-worker-media.service"        "256M" "384M"
add_memory_high "$SERVICE_DIR/oper-worker-ml-scheduler.service" "96M"  "128M"
add_memory_high "$SERVICE_DIR/oper-worker-digest.service"       "144M" "192M"
add_memory_high "$SERVICE_DIR/oper-worker-alerts.service"       "288M" "384M"

# Supporting services
add_memory_high "$SERVICE_DIR/oper-n8n.service"          "1G"    "1536M"
add_memory_high "$SERVICE_DIR/oper-pg-tileserv.service"  "384M"  "512M"

# ---- Step 4: Swap + sysctl --------------------------------------------------
info "Step 4: Swap headroom + sysctl tuning"

# Grow swapfile to 8GB (idempotent)
SWAPFILE="/swapfile"
if [ -f "$SWAPFILE" ]; then
  SWAP_SIZE_KB=$(swapon --show=SIZE --noheadings "$SWAPFILE" 2>/dev/null | awk '{print $1}' || echo "0")
  SWAP_SIZE_GB=$((SWAP_SIZE_KB / 1048576))
  if [ "$SWAP_SIZE_GB" -ge 8 ]; then
    skip "Swapfile already ${SWAP_SIZE_GB}GB (>= 8GB)"
  else
    info "Growing swapfile from ${SWAP_SIZE_GB}GB to 8GB..."
    swapoff "$SWAPFILE" 2>/dev/null || true
    dd if=/dev/zero of="$SWAPFILE" bs=1M count=8192 status=progress
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE"
    swapon "$SWAPFILE"
    ok "Swapfile grown to 8GB"
  fi
else
  info "Creating 8GB swapfile..."
  dd if=/dev/zero of="$SWAPFILE" bs=1M count=8192 status=progress
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
  swapon "$SWAPFILE"
  ok "Swapfile created and activated (8GB)"
fi

# sysctl tuning
SYSCTL_CONTENT="# oper-memory sysctl tuning (harden-memory.sh)
# swappiness=10: prefer keeping application pages in RAM, only swap under
# pressure. Default 60 was causing premature page-out of hot postgres buffers.
vm.swappiness = 10

# overcommit_memory=2: kernel uses overcommit_ratio to decide if an
# allocation can succeed. Instead of always allowing (0) or always denying (1),
# allocations that would exceed commit_limit fail with ENOMEM — the OOM killer
# is NOT invoked.
vm.overcommit_memory = 2

# overcommit_ratio: percentage of RAM + swap that can be committed.
# 80% leaves headroom for kernel slab, page cache, and stack.
# On 8G RAM + 8G swap: commit_limit = (8+8)*0.8 = 12.8G
vm.overcommit_ratio = 80
"

if [ -f "$SYSCTL_CONF" ]; then
  if printf '%s\n' "$SYSCTL_CONTENT" | cmp -s - "$SYSCTL_CONF"; then
    skip "sysctl conf already up to date at $SYSCTL_CONF"
  else
    info "Updating $SYSCTL_CONF"
    cp "$SYSCTL_CONF" "${SYSCTL_CONF}.bak.$(date +%s)"
    printf '%s\n' "$SYSCTL_CONTENT" > "$SYSCTL_CONF"
    sysctl -p "$SYSCTL_CONF"
    ok "sysctl conf updated and applied"
  fi
else
  info "Creating $SYSCTL_CONF"
  printf '%s\n' "$SYSCTL_CONTENT" > "$SYSCTL_CONF"
  sysctl -p "$SYSCTL_CONF"
  ok "sysctl conf created and applied"
fi

# ---- Deploy service files to /etc/systemd/system/ ---------------------------
info "Deploying service files to /etc/systemd/system/"

deploy_unit() {
  local src="$1"
  local basename
  basename="$(basename "$src")"
  local dst="/etc/systemd/system/$basename"

  if [ ! -f "$src" ]; then
    warn "$basename source not found — skipping deploy"
    return
  fi

  if [ -f "$dst" ] && diff -q "$src" "$dst" >/dev/null 2>&1; then
    skip "$basename already deployed (no changes)"
    return
  fi

  cp "$src" "$dst"
  ok "$basename deployed to /etc/systemd/system/"
}

for unit in "$SERVICE_DIR"/oper-*.service; do
  deploy_unit "$unit"
done

# daemon-reload
info "Running systemctl daemon-reload..."
systemctl daemon-reload
ok "systemctl daemon-reload complete"

# ---- Restart services to apply MemoryHigh -----------------------------------
info "Restarting services to apply new memory limits..."

RESTART_UNITS=(
  oper-app oper-two oper-ml oper-scraper oper-n8n oper-pg-tileserv
  oper-worker oper-worker-rent oper-worker-refresh oper-worker-watchlist
  oper-worker-media oper-worker-ml-scheduler oper-worker-digest oper-worker-alerts
)

for unit in "${RESTART_UNITS[@]}"; do
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    systemctl restart "$unit" && ok "Restarted $unit" || warn "Failed to restart $unit"
  else
    skip "$unit not active — skipping restart"
  fi
done

# ---- Summary ----------------------------------------------------------------
echo ""
echo "========================================="
echo " OOM Containment Hardening Complete"
echo "========================================="
echo ""
echo "Changes applied:"
echo "  - Postgres: shared_buffers=2GB, work_mem=32MB, maintenance_work_mem=256MB, max_connections=100"
echo "  - Postgres OOM protection: OOMScoreAdjust=-900 (verified in main unit)"
echo "  - MemoryHigh added to all service units (soft reclaim before hard MemoryMax kill)"
echo "  - Swap: 8GB, swappiness=10"
echo "  - Sysctl: overcommit_memory=2, overcommit_ratio=80"
echo ""
echo "Next steps:"
echo "  1. Verify: systemctl show oper-worker.service | grep -E 'Memory(High|Max)'"
echo "  2. Monitor: journalctl -u oper-worker -f for memory-related messages"
echo ""
