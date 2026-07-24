#!/bin/bash
set -euo pipefail

# =============================================================================
# attach-floating-ip.sh — Idempotent floating IP attach for prod server
#
# WHY: A floating IP lets DNS point at a single address forever. When the prod
# box is swapped (rescue, rebuild, new server), we reattach the float to the
# new box — zero DNS edits, zero TTL propagation wait, zero downtime window.
#
# STEP 1 (this script): create + attach floating IP
# STEP 2 (one-time user action): edit DNS A records for one.octavo.press and
#         two.octavo.press to point at the floating IP instead of the fixed IP
# STEP 3 (ongoing): box swaps = reattach float via this script
# =============================================================================

# ---------------------------------------------------------------------------
# Config — override via positional arg, env var, or leave as-is
# ---------------------------------------------------------------------------
PROD_SERVER_UUID="${1:-${PROD_SERVER_UUID:-003b1626}}"
FLOATING_IP_TAG="oper-prod"
ZONE="us-sjo1"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if ! command -v upctl &>/dev/null; then
  echo "ERROR: upctl not found in PATH. Install it or run on a box with UpCloud CLI." >&2
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq not found in PATH. Install it first." >&2
  exit 1
fi

echo "==> Using prod server UUID: ${PROD_SERVER_UUID}"
echo "==> Zone: ${ZONE}"
echo "==> Tag: ${FLOATING_IP_TAG}"

# ---------------------------------------------------------------------------
# Step 1: Find or create floating IP
# ---------------------------------------------------------------------------
echo ""
echo "==> Checking for existing floating IP with tag '${FLOATING_IP_TAG}'..."

# Find existing floating IP: prefer tag match, fall back to zone+family match
EXISTING_FLOAT=$(upctl floating-ip list --output json 2>/dev/null | jq -r \
  --arg tag "${FLOATING_IP_TAG}" \
  --arg zone "${ZONE}" \
  '
    [.[] | select(
      # Primary: match by tag
      (.tags != null and (.tags | map(.name // .) | index($tag)))
      or
      # Fallback: match by zone + address family (only one floating IP per zone on trial)
      (.zone == $zone and .address_family == "IPv4")
    )] | first | .address // empty
  ' 2>/dev/null || true)

if [[ -n "${EXISTING_FLOAT}" ]]; then
  echo "    Found existing floating IP: ${EXISTING_FLOAT}"
  FLOAT_IP="${EXISTING_FLOAT}"
else
  echo "    No floating IP found. Creating one in ${ZONE}..."
  CREATE_OUTPUT=$(upctl floating-ip create \
    --address-family IPv4 \
    --zone "${ZONE}" \
    --output json 2>&1) || {
    echo "ERROR: Failed to create floating IP:" >&2
    echo "${CREATE_OUTPUT}" >&2
    exit 1
  }

  FLOAT_IP=$(echo "${CREATE_OUTPUT}" | jq -r '.address')
  NEW_UUID=$(echo "${CREATE_OUTPUT}" | jq -r '.uuid // empty')

  if [[ -z "${FLOAT_IP}" ]]; then
    echo "ERROR: Could not parse floating IP address from create output:" >&2
    echo "${CREATE_OUTPUT}" >&2
    exit 1
  fi

  echo "    Created floating IP: ${FLOAT_IP} (uuid: ${NEW_UUID})"
fi

# ---------------------------------------------------------------------------
# Step 2: Attach to prod server (skip if already attached)
# ---------------------------------------------------------------------------
echo ""
echo "==> Checking if floating IP ${FLOAT_IP} is attached to ${PROD_SERVER_UUID}..."

ATTACHED_SERVER=$(upctl floating-ip list --output json 2>/dev/null | jq -r \
  --arg ip "${FLOAT_IP}" \
  '.[] | select(.address == $ip) | .server_uuid // empty' | head -1)

if [[ "${ATTACHED_SERVER}" == "${PROD_SERVER_UUID}" ]]; then
  echo "    Already attached to ${PROD_SERVER_UUID}. Nothing to do."
elif [[ -n "${ATTACHED_SERVER}" && "${ATTACHED_SERVER}" != "null" ]]; then
  echo "    WARNING: Floating IP is currently attached to a different server (${ATTACHED_SERVER})." >&2
  echo "    Reassigning to ${PROD_SERVER_UUID}..."
  upctl floating-ip assign "${FLOAT_IP}" "${PROD_SERVER_UUID}" || {
    echo "ERROR: Failed to reassign floating IP." >&2
    exit 1
  }
  echo "    Reassigned successfully."
else
  echo "    Attaching to ${PROD_SERVER_UUID}..."
  upctl floating-ip assign "${FLOAT_IP}" "${PROD_SERVER_UUID}" || {
    echo "ERROR: Failed to assign floating IP." >&2
    exit 1
  }
  echo "    Attached successfully."
fi

# ---------------------------------------------------------------------------
# Step 3: Print DNS cutover instructions
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  FLOATING IP READY: ${FLOAT_IP}"
echo "============================================================"
echo ""
echo "  DNS CUTOVER (ONE-TIME, do this now if not done already):"
echo ""
echo "    Update A records for:"
echo "      one.octavo.press  ->  ${FLOAT_IP}"
echo "      two.octavo.press  ->  ${FLOAT_IP}"
echo ""
echo "  Current fixed IP: 209.50.61.64 (will become irrelevant)"
echo ""
echo "  VERIFY after DNS propagates:"
echo "    curl --resolve one.octavo.press:443:${FLOAT_IP} https://one.octavo.press/api/health"
echo ""
echo "  AFTER THIS: box swaps = run this script against the new box."
echo "  DNS never needs editing again."
echo "============================================================"
