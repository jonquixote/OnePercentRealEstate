#!/usr/bin/env bash
# =============================================================================
# preflight.sh — validate deploy configuration against the RUNNING system,
# BEFORE anything is built or restarted. Fail-closed.
#
# Why: on 2026-07-24 `gen-env.sh` emitted DATABASE_URL=…:6432 while PgBouncer
# was not installed. Nothing checked that the port existed, so the deploy
# proceeded and took the app down (health 503, db down). Every check here
# answers "is what we are about to deploy actually true right now?", not
# merely "is this variable non-empty".
#
# Usage:  bash ops/ci/preflight.sh            # check the live /etc/oper.env
#         ENV_FILE=/tmp/x bash ops/ci/preflight.sh
# Exit 0 = safe to deploy. Non-zero = abort (nothing has been mutated yet).
# =============================================================================
set -uo pipefail   # NOT -e: run every check, then report

ENV_FILE="${ENV_FILE:-/etc/oper.env}"
RETRIES="${PREFLIGHT_RETRIES:-5}"    # a dependency may be mid-restart
RETRY_SLEEP="${PREFLIGHT_RETRY_SLEEP:-2}"

FAILED=0
pass() { printf "  \033[1;32mPASS\033[0m  %s\n" "$*"; }
fail() { printf "  \033[1;31mFAIL\033[0m  %s\n" "$*"; FAILED=1; }
skip() { printf "  \033[1;33mSKIP\033[0m  %s\n" "$*"; }

echo "--- Preflight: validating config against the running system ---"

if [[ ! -f "$ENV_FILE" ]]; then
  fail "$ENV_FILE not found (run gen-env.sh first)"
  exit 1
fi

read_key() { grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-; }

# host:port out of a URL, without ever echoing credentials.
url_hostport() {
  local url="$1" hostport
  hostport="${url#*://}"          # strip scheme
  hostport="${hostport#*@}"       # strip user:pass@ (if present)
  hostport="${hostport%%/*}"      # strip /path
  hostport="${hostport%%\?*}"     # strip ?query
  printf '%s' "$hostport"
}

# Is something listening on host:port? Retries briefly so a service that is
# mid-restart isn't mistaken for a misconfiguration.
port_open() {
  local host="$1" port="$2" i
  [[ "$host" == "localhost" ]] && host="127.0.0.1"
  for ((i = 1; i <= RETRIES; i++)); do
    if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -qE "[:.]${port}[[:space:]]"; then
      return 0
    fi
    # Fallback for hosts without ss / non-local addresses.
    if command -v nc >/dev/null 2>&1 && nc -z -w2 "$host" "$port" 2>/dev/null; then
      return 0
    fi
    [[ $i -lt $RETRIES ]] && sleep "$RETRY_SLEEP"
  done
  return 1
}

# --- 1. Every DB URL points at a port that is actually listening -------------
# This is the check that would have prevented the 2026-07-24 outage.
for envf in "$ENV_FILE" /etc/oper-role-*.env; do
  [[ -f "$envf" ]] || continue
  for key in DATABASE_URL DATABASE_URL_DIRECT; do
    url="$(grep "^${key}=" "$envf" 2>/dev/null | head -1 | cut -d= -f2-)"
    [[ -z "$url" ]] && continue
    hp="$(url_hostport "$url")"
    host="${hp%%:*}"; port="${hp##*:}"
    [[ "$host" == "$port" ]] && port=5432          # no explicit port
    if port_open "$host" "$port"; then
      pass "$(basename "$envf") $key -> ${host}:${port} listening"
    else
      fail "$(basename "$envf") $key -> ${host}:${port} NOT listening — deploying this would break the app"
    fi
  done
done

# --- 2. Redis ----------------------------------------------------------------
redis_url="$(read_key REDIS_URL)"
if [[ -n "$redis_url" ]]; then
  hp="$(url_hostport "$redis_url")"; host="${hp%%:*}"; port="${hp##*:}"
  [[ "$host" == "$port" ]] && port=6379
  if port_open "$host" "$port"; then
    pass "REDIS_URL -> ${host}:${port} listening"
  else
    fail "REDIS_URL -> ${host}:${port} NOT listening"
  fi
else
  skip "REDIS_URL not set"
fi

# --- 2b. Scraper pool has at least one reachable endpoint --------------------
# The crawl stalled ~10h on 2026-07-24 because the pool's only endpoint was
# unreachable. FAIL if none answer (deploying that ships a dead crawl); WARN if
# some are dead — a partially degraded pool still crawls and must stay
# deployable. "Answers" means it speaks HTTP at all: the scraper has no route
# at / so 404 is a healthy response; only a connection failure is down.
pool="$(read_key SCRAPER_URLS)"
[[ -z "$pool" ]] && pool="$(read_key SCRAPER_URL)"
if [[ -n "$pool" ]]; then
  reachable=0; dead=""
  IFS=',' read -ra endpoints <<< "$pool"
  for ep in "${endpoints[@]}"; do
    ep="$(printf '%s' "$ep" | tr -d '[:space:]')"
    [[ -z "$ep" ]] && continue
    if curl -s -m5 -o /dev/null "$ep" 2>/dev/null; then
      pass "scraper endpoint ${ep} reachable"
      reachable=$((reachable + 1))
    else
      dead="${dead} ${ep}"
    fi
  done
  if [[ $reachable -eq 0 ]]; then
    fail "NO scraper endpoint is reachable (${pool}) — deploying this ships a dead crawl"
  elif [[ -n "$dead" ]]; then
    skip "scraper pool degraded — unreachable:${dead} (${reachable} healthy, deploy allowed)"
  fi
else
  skip "SCRAPER_URLS/SCRAPER_URL not set"
fi

# --- 3. The build scope's systemd properties actually parse ------------------
# Catches an invalid `-p` (e.g. Nice=) BEFORE it aborts the build mid-deploy.
if command -v systemd-run >/dev/null 2>&1 && [[ "$(id -u)" == "0" ]]; then
  if systemd-run --scope -p MemoryMax=6G -p MemoryHigh=5G /bin/true >/dev/null 2>&1; then
    pass "systemd-run scope properties accepted (MemoryMax/MemoryHigh)"
  else
    fail "systemd-run rejected the build scope properties — the build step would abort"
  fi
else
  skip "systemd-run dry check (needs root on a systemd host)"
fi

# --- 4. Required env keys present and not placeholders -----------------------
for key in POSTGRES_PASSWORD AUTH_SECRET DATABASE_URL REDIS_URL; do
  val="$(read_key "$key")"
  if [[ -z "$val" ]]; then
    fail "$key is missing from $ENV_FILE"
  elif [[ "$val" =~ (CHANGEME|changeme|placeholder|xxxx|your_|TODO) ]]; then
    fail "$key still holds a placeholder value"
  else
    pass "$key present"
  fi
done

echo ""
if [[ $FAILED -ne 0 ]]; then
  printf "\033[1;31m=== PREFLIGHT FAILED — aborting before any build/restart ===\033[0m\n"
  echo "Nothing has been mutated. Fix the failing checks and re-run the deploy."
  exit 1
fi
printf "\033[1;32m=== Preflight passed ===\033[0m\n"
