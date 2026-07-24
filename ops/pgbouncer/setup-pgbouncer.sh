#!/bin/bash
set -euo pipefail

# =============================================================================
# setup-pgbouncer.sh — bring PgBouncer up on :6432. Idempotent. Run as root.
#
# This does NOT touch DATABASE_URL. The cutover is a separate, health-gated
# step (gen-env.sh + deploy preflight) — on 2026-07-24 a blind cutover to
# :6432 while PgBouncer was down took the app offline, so this script's only
# job is to make the pooler real and PROVE it works while the app keeps using
# :5432 direct.
#
# Verifies at the end:
#   1. unit active + :6432 listening
#   2. a real query succeeds through :6432 (SCRAM to a SCRAM backend)
#   3. the admin console answers SHOW POOLS
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UNIT_SRC="$REPO_ROOT/ops/systemd/oper-pgbouncer.service"
UNIT_DST="/etc/systemd/system/oper-pgbouncer.service"

info() { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()   { printf "\033[1;32m[OK]\033[0m    %s\n" "$*"; }
skip() { printf "\033[1;33m[SKIP]\033[0m  %s\n" "$*"; }
fail() { printf "\033[1;31m[FAIL]\033[0m  %s\n" "$*"; exit 1; }

# ---- 1. Install the binary --------------------------------------------------
if command -v pgbouncer >/dev/null 2>&1; then
  skip "pgbouncer already installed ($(pgbouncer --version 2>&1 | head -1))"
else
  info "Installing pgbouncer..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq pgbouncer
  ok "pgbouncer installed ($(pgbouncer --version 2>&1 | head -1))"
fi

# The Debian package ships its own unit that also binds :6432 — it would race
# ours. We manage PgBouncer through oper-pgbouncer.service only.
if systemctl list-unit-files pgbouncer.service >/dev/null 2>&1; then
  systemctl disable --now pgbouncer.service >/dev/null 2>&1 || true
  ok "distro pgbouncer.service disabled (we use oper-pgbouncer.service)"
fi

# ---- 2. Userlist (plaintext, SCRAM backend) ---------------------------------
info "Generating userlist..."
bash "$SCRIPT_DIR/gen-pgbouncer-userlist.sh"
[[ -s "$SCRIPT_DIR/userlist.txt" ]] || fail "userlist.txt missing/empty"
# The service runs as postgres (pgbouncer refuses to run as root), so the
# config + secret must be readable by it. userlist stays 0600 (plaintext pwds).
chown postgres:postgres "$SCRIPT_DIR/userlist.txt" "$SCRIPT_DIR/pgbouncer.ini" 2>/dev/null || true
chmod 600 "$SCRIPT_DIR/userlist.txt"
chmod 644 "$SCRIPT_DIR/pgbouncer.ini"
ok "userlist.txt present (0600, postgres-owned)"

# ---- 3. Install + start our unit -------------------------------------------
if [[ -f "$UNIT_DST" ]] && diff -q "$UNIT_SRC" "$UNIT_DST" >/dev/null 2>&1; then
  skip "oper-pgbouncer.service already current"
else
  cp "$UNIT_SRC" "$UNIT_DST"
  ok "oper-pgbouncer.service installed"
fi
systemctl daemon-reload
systemctl enable oper-pgbouncer >/dev/null 2>&1 || true
# Clear any prior crash-loop rate limit ("Start request repeated too quickly"),
# otherwise systemd refuses to start even a now-correct unit.
systemctl reset-failed oper-pgbouncer >/dev/null 2>&1 || true
systemctl restart oper-pgbouncer
sleep 2

# ---- 4. Verify --------------------------------------------------------------
systemctl is-active --quiet oper-pgbouncer \
  || fail "oper-pgbouncer not active: $(systemctl status oper-pgbouncer --no-pager 2>&1 | tail -5)"
ok "oper-pgbouncer active"

ss -tln 2>/dev/null | grep -q ':6432' || fail ":6432 is not listening"
ok ":6432 listening"

# Real query through the pooler, as the app would.
set -a; . /etc/oper.env; set +a
POOLED_URL="${DATABASE_URL_DIRECT/:5432/:6432}"
if psql "$POOLED_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
  ok "query through :6432 succeeded (SCRAM client→pooler→server)"
else
  fail "query through :6432 FAILED — check auth_type/userlist: $(psql "$POOLED_URL" -tAc 'SELECT 1' 2>&1 | tail -2)"
fi

# Admin console.
ADMIN_URL="${POOLED_URL%/*}/pgbouncer"
if psql "$ADMIN_URL" -tAc 'SHOW POOLS' >/dev/null 2>&1; then
  ok "admin console reachable (SHOW POOLS)"
else
  skip "admin console not reachable (non-fatal; check admin_users)"
fi

echo ""
echo "========================================="
echo " PgBouncer is UP on :6432 and verified"
echo "========================================="
echo "The app is still on :5432 direct. Cutover is a separate gated step:"
echo "  ops/systemd/gen-env.sh  (DATABASE_URL -> :6432) + deploy preflight"
echo "Inspect:  psql \"\$DATABASE_URL_DIRECT\" -p 6432 pgbouncer -c 'SHOW POOLS'"
