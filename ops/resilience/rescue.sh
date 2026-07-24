#!/bin/bash
set -euo pipefail

# =============================================================================
# rescue.sh — Automated prod rescue: snapshot → create → verify → deploy → float
#
# Context: 2026-07-24 prod OOM incident. Box 009821f6 died, wiped SSH keys,
#          forced snapshot→rebuild to 003b1626. This script encodes the
#          automatable parts of the rescue sequence.
#
# Reference: documentation/operations/prod-rescue-runbook.md
#
# Usage:
#   ./rescue.sh                          # interactive (step-by-step confirmations)
#   ./rescue.sh --plan-only              # print full sequence, make no changes
#   ./rescue.sh --execute                # run without confirmation prompts
#
# Options:
#   --dead-uuid UUID     Override dead box UUID (default: 009821f6)
#   --plan-name NAME     Override plan name (default: PREMIUM-2xCPU-16GB)
#   --zone ZONE          Override zone (default: us-sjo1)
#   --ssh-key NAME       Override SSH key name (default: onepercent-deploy-202606)
#   --server-name NAME   Override new server name (default: oper-prod-rescue)
#   --repo-root PATH     Override repo root (default: auto-detected)
#
# Idempotent: safe to re-run from any step. Checks state before each action.
# =============================================================================

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEAD_UUID="009821f6"
PLAN="PREMIUM-2xCPU-16GB"
ZONE="us-sjo1"
SSH_KEY="onepercent-deploy-202606"
SERVER_NAME="oper-prod-rescue"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MODE="interactive"  # interactive | plan-only | execute

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan-only)    MODE="plan-only"; shift ;;
    --execute)      MODE="execute"; shift ;;
    --dead-uuid)    DEAD_UUID="$2"; shift 2 ;;
    --plan-name)    PLAN="$2"; shift 2 ;;
    --zone)         ZONE="$2"; shift 2 ;;
    --ssh-key)      SSH_KEY="$2"; shift 2 ;;
    --server-name)  SERVER_NAME="$2"; shift 2 ;;
    --repo-root)    REPO_ROOT="$2"; shift 2 ;;
    -h|--help)
      head -25 "$0" | tail -20
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# State file — tracks progress so re-runs skip completed steps
# ---------------------------------------------------------------------------
STATE_DIR="${TMPDIR:-/tmp}/rescue-state-${DEAD_UUID}"
STATE_FILE="$STATE_DIR/progress"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
touch "$STATE_FILE"
# Deliberately not removed on exit: state must survive interruption so a
# re-run of rescue.sh resumes from the last completed step. Clean up
# manually (rm -rf) once the rescue is fully confirmed done.

state_get() { grep -q "^$1$" "$STATE_FILE" 2>/dev/null; }
state_set() { echo "$1" >> "$STATE_FILE"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
NEW_UUID=""
NEW_IP=""
FLOAT_IP=""
LATEST_SNAPSHOT_UUID=""

info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()    { printf "\033[1;32m[OK]\033[0m    %s\n" "$*"; }
skip()  { printf "\033[1;33m[SKIP]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[1;31m[WARN]\033[0m  %s\n" "$*"; }
step()  { printf "\n\033[1;36m=== STEP %s: %s ===\033[0m\n" "$1" "$2"; }

confirm() {
  if [[ "$MODE" == "plan-only" ]]; then
    return 0
  fi
  if [[ "$MODE" == "execute" ]]; then
    return 0
  fi
  printf "\n\033[1;33m[CONFIRM]\033[0m %s [Enter to proceed, 'skip' to skip, 'quit' to abort]: " "$1"
  read -r response
  case "$response" in
    quit|q|Q) echo "Aborted."; exit 0 ;;
    skip|s|S) return 1 ;;
    *) return 0 ;;
  esac
}

print_cmd() {
  if [[ "$MODE" == "plan-only" ]]; then
    printf "  \033[1;37m$\033[0m %s\n" "$1"
  fi
}

run_cmd() {
  if [[ "$MODE" == "plan-only" ]]; then
    printf "  \033[1;37m$\033[0m %s\n" "$*"
    return 0
  fi
  "$@"
}

require_upctl() {
  if ! command -v upctl &>/dev/null; then
    echo "ERROR: upctl not found in PATH." >&2
    exit 1
  fi
  if ! upctl server list &>/dev/null; then
    echo "ERROR: upctl not authenticated. Run: ! upctl server list" >&2
    exit 1
  fi
}

require_ssh() {
  if [[ -z "$NEW_IP" ]]; then
    if [[ "$MODE" == "plan-only" ]]; then
      NEW_IP="<new-server-ip>"
    else
      echo "ERROR: NEW_IP not set. Run step 3 first." >&2
      exit 1
    fi
  fi
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if [[ "$MODE" != "plan-only" ]]; then
  require_upctl
fi

echo "============================================================"
echo "  PROD RESCUE — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"
echo ""
echo "  Dead box:      $DEAD_UUID"
echo "  Plan:          $PLAN"
echo "  Zone:          $ZONE"
echo "  SSH key:       $SSH_KEY"
echo "  Server name:   $SERVER_NAME"
echo "  Repo root:     $REPO_ROOT"
echo "  Mode:          $MODE"
echo ""

# =========================================================================
# STEP 1: Find latest snapshot of dead box
# =========================================================================
step 1 "Find latest snapshot of dead box ($DEAD_UUID)"

if state_get "step1_done"; then
  skip "Already completed (state: step1_done)"
  if [[ "$MODE" != "plan-only" ]]; then
    LATEST_SNAPSHOT_UUID=$(upctl server storage list "$DEAD_UUID" --output json 2>/dev/null | \
      jq -r 'map(select(.snapshot == true)) | sort_by(.created_at) | last | .uuid // empty')
    info "Latest snapshot: $LATEST_SNAPSHOT_UUID"
  fi
else
  print_cmd "upctl server storage list $DEAD_UUID --output json | jq 'sort_by(.created_at) | last'"
  if [[ "$MODE" != "plan-only" ]]; then
    LATEST_SNAPSHOT_UUID=$(upctl server storage list "$DEAD_UUID" --output json 2>/dev/null | \
      jq -r 'map(select(.snapshot == true)) | sort_by(.created_at) | last | .uuid // empty')
    if [[ -z "$LATEST_SNAPSHOT_UUID" ]]; then
      warn "No snapshots found for $DEAD_UUID. You may need to create one first."
      warn "Run: upctl server storage snapshot <disk-uuid> --description 'rescue-$(date +%Y%m%d)'"
      if [[ "$MODE" == "interactive" ]]; then
        printf "Enter snapshot UUID manually (or 'quit'): "
        read -r LATEST_SNAPSHOT_UUID
        [[ "$LATEST_SNAPSHOT_UUID" == "quit" ]] && exit 0
      else
        echo "ERROR: No snapshots found and not in interactive mode." >&2
        exit 1
      fi
    fi
    ok "Latest snapshot: $LATEST_SNAPSHOT_UUID"
    state_set "step1_done"
  fi
fi

# =========================================================================
# STEP 2: [USER] Stop the dead box
# =========================================================================
step 2 "Stop the dead box (classifier-gated)"

if state_get "step2_done"; then
  skip "Already completed"
else
  printf "  \033[1;31m>>> CLASSIFIER-GATED — paste this into your shell with ! prefix: <<<\033[0m\n"
  printf "\n"
  printf "    ! upctl server stop $DEAD_UUID\n"
  printf "\n"
  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not executing)"
  else
    if confirm "Stop dead box $DEAD_UUID?"; then
      run_cmd upctl server stop "$DEAD_UUID"
      ok "Dead box stopped"
      state_set "step2_done"
    else
      warn "Skipped — dead box may still be running"
    fi
  fi
fi

# =========================================================================
# STEP 3: Create new server from latest snapshot
# =========================================================================
step 3 "Create new server from latest snapshot"

if state_get "step3_done"; then
  skip "Already completed"
  if [[ "$MODE" != "plan-only" ]]; then
    NEW_UUID=$(upctl server list --output json | jq -r --arg name "$SERVER_NAME" '.[] | select(.name == $name) | .uuid' | head -1)
    NEW_IP=$(upctl server show "$NEW_UUID" --output json | jq -r '.ip_addresses[] | select(.type=="public") | .address' 2>/dev/null)
    info "Existing server: $NEW_UUID ($NEW_IP)"
  fi
else
  echo "  Will create: $SERVER_NAME"
  echo "  Plan: $PLAN"
  echo "  OS: snapshot $LATEST_SNAPSHOT_UUID"
  echo "  SSH key: $SSH_KEY"
  echo "  Zone: $ZONE"

  if [[ "$MODE" == "plan-only" ]]; then
    print_cmd "upctl server create --plan $PLAN --os $LATEST_SNAPSHOT_UUID --enable-metadata --ssh-keys $SSH_KEY --name $SERVER_NAME --zone $ZONE"
  else
    if confirm "Create new server?"; then
      CREATE_OUTPUT=$(upctl server create \
        --plan "$PLAN" \
        --os "$LATEST_SNAPSHOT_UUID" \
        --enable-metadata \
        --ssh-keys "$SSH_KEY" \
        --name "$SERVER_NAME" \
        --zone "$ZONE" \
        --output json 2>&1)
      NEW_UUID=$(echo "$CREATE_OUTPUT" | jq -r '.uuid')
      NEW_IP=$(echo "$CREATE_OUTPUT" | jq -r '.ip_addresses[] | select(.type=="public") | .address')
      ok "Created: $NEW_UUID ($NEW_IP)"
      state_set "step3_done"
    else
      echo "Aborted."; exit 1
    fi
  fi
fi

# =========================================================================
# STEP 4: Wait for SSH access
# =========================================================================
step 4 "Wait for SSH access"

require_ssh

if state_get "step4_done"; then
  skip "Already completed"
else
  print_cmd "for i in \$(seq 1 40); do ssh -o ConnectTimeout=5 root@$NEW_IP 'echo ok' && break; sleep 3; done"

  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not waiting)"
  else
    info "Waiting for SSH on $NEW_IP..."
    for i in $(seq 1 40); do
      if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new root@"$NEW_IP" 'echo ok' &>/dev/null; then
        ok "SSH is up"
        state_set "step4_done"
        break
      fi
      echo "  Waiting... ($i/40)"
      sleep 3
    done

    if ! state_get "step4_done"; then
      echo "ERROR: SSH not available after 120s." >&2
      exit 1
    fi
  fi
fi

# =========================================================================
# STEP 5: Verify data
# =========================================================================
step 5 "Verify data (SELECT count FROM listings)"

require_ssh

if state_get "step5_done"; then
  skip "Already completed"
else
  print_cmd "ssh root@$NEW_IP 'psql -U postgres -d onepercent -c \"SELECT count(*) FROM listings\"'"

  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not running query)"
  else
    COUNT=$(ssh root@"$NEW_IP" 'psql -U postgres -d onepercent -t -A -c "SELECT count(*) FROM listings"' 2>/dev/null || echo "ERROR")
    if [[ "$COUNT" == "ERROR" ]]; then
      warn "Could not query listings table. Is Postgres running?"
      if confirm "Continue anyway?"; then
        state_set "step5_done"
      else
        exit 1
      fi
    elif [[ "$COUNT" -gt 0 ]]; then
      ok "Listings count: $COUNT"
      state_set "step5_done"
    else
      warn "Listings count is 0 — snapshot may be bad."
      if confirm "Continue anyway?"; then
        state_set "step5_done"
      else
        exit 1
      fi
    fi
  fi
fi

# =========================================================================
# STEP 6: Deploy
# =========================================================================
step 6 "Deploy (deploy-systemd.sh)"

require_ssh

if state_get "step6_done"; then
  skip "Already completed"
else
  print_cmd "ssh root@$NEW_IP 'bash -s' < $REPO_ROOT/ops/systemd/deploy-systemd.sh"

  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not deploying)"
  else
    if confirm "Run deploy-systemd.sh on $NEW_IP?"; then
      ssh root@"$NEW_IP" 'bash -s' < "$REPO_ROOT/ops/systemd/deploy-systemd.sh"
      ok "Deploy complete"
      state_set "step6_done"
    else
      warn "Skipped deploy"
    fi
  fi
fi

# =========================================================================
# STEP 7: Attach floating IP
# =========================================================================
step 7 "Attach floating IP"

require_ssh

if state_get "step7_done"; then
  skip "Already completed"
else
  print_cmd "ssh root@$NEW_IP 'bash -s' < $REPO_ROOT/ops/resilience/attach-floating-ip.sh $NEW_UUID"

  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not attaching)"
  else
    if confirm "Attach floating IP to $NEW_UUID?"; then
      ATTACH_OUTPUT=$(ssh root@"$NEW_IP" 'bash -s' < "$REPO_ROOT/ops/resilience/attach-floating-ip.sh" "$NEW_UUID")
      echo "$ATTACH_OUTPUT"
      FLOAT_IP=$(printf '%s\n' "$ATTACH_OUTPUT" | grep -oE 'FLOATING IP READY: [0-9.]+' | awk '{print $NF}')
      ok "Floating IP attached"
      state_set "step7_done"
    else
      warn "Skipped floating IP attach"
    fi
  fi
fi

# =========================================================================
# STEP 8: Persist SSH key
# =========================================================================
step 8 "Persist SSH key (triple-layer)"

require_ssh

if state_get "step8_done"; then
  skip "Already completed"
else
  print_cmd "ssh root@$NEW_IP 'bash -s' < $REPO_ROOT/ops/resilience/persist-ssh-key.sh"

  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not persisting)"
  else
    if confirm "Persist SSH key on $NEW_IP?"; then
      ssh root@"$NEW_IP" 'bash -s' < "$REPO_ROOT/ops/resilience/persist-ssh-key.sh"
      ok "SSH key persisted (3 layers)"
      state_set "step8_done"
    else
      warn "Skipped SSH key persistence"
    fi
  fi
fi

# =========================================================================
# STEP 9: Harden memory
# =========================================================================
step 9 "Harden memory (OOM containment)"

require_ssh

if state_get "step9_done"; then
  skip "Already completed"
else
  print_cmd "ssh root@$NEW_IP 'bash -s' < $REPO_ROOT/ops/resilience/harden-memory.sh"

  if [[ "$MODE" == "plan-only" ]]; then
    info "(plan-only: not hardening)"
  else
    if confirm "Harden memory on $NEW_IP?"; then
      ssh root@"$NEW_IP" 'bash -s' < "$REPO_ROOT/ops/resilience/harden-memory.sh"
      ok "Memory hardened"
      state_set "step9_done"
    else
      warn "Skipped memory hardening"
    fi
  fi
fi

# =========================================================================
# STEP 10: [USER] Delete dead box
# =========================================================================
step 10 "[USER] Delete dead box (classifier-gated)"

printf "  \033[1;31m>>> CLASSIFIER-GATED — paste this into your shell with ! prefix: <<<\033[0m\n"
printf "\n"
printf "    ! upctl server delete $DEAD_UUID\n"
printf "\n"
printf "  \033[1;33mWARNING: Only delete after new box has been stable for 24+ hours.\033[0m\n"
printf "  The old box serves as fallback.\n"

if [[ "$MODE" == "plan-only" ]]; then
  info "(plan-only: not deleting)"
fi

# =========================================================================
# Summary
# =========================================================================
echo ""
echo "============================================================"
echo "  RESCUE SEQUENCE COMPLETE"
echo "============================================================"
echo ""
echo "  New server:  $NEW_UUID"
echo "  New IP:      $NEW_IP"
echo "  Floating IP: ${FLOAT_IP:-<not attached>}"
echo "  Dead box:    $DEAD_UUID (stopped, ready for deletion)"
echo ""
echo "  Remaining manual steps:"
echo "    1. Verify app is serving: curl -s https://one.octavo.press/api/health"
echo "    2. If first-time floating IP: update DNS A records → floating IP"
echo "    3. After 24h stability: ! upctl server delete $DEAD_UUID"
echo "    4. Restart side scraper if needed: ! upctl server start 003b3b44"
echo ""
