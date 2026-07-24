#!/bin/bash
#
# persist-ssh-key.sh — Triple-persist the deploy SSH pubkey on a prod box.
#
# Root cause addressed:
#   2026-07-24 incident — /root/.ssh/authorized_keys was wiped on reboot,
#   locking the operator out. A single layer (authorized_keys) is fragile.
#   This script persists the deploy key across THREE independent layers so
#   a reboot/rebuild can never lock us out:
#
#     Layer 1 — authorized_keys file (/root/.ssh/authorized_keys)
#               The immediate SSH login key. Wiped on reboot was the root cause.
#     Layer 2 — UpCloud stored SSH key (upctl ssh-key)
#               Account-level key attached at `upctl server create --ssh-keys`
#               and any rebuild, so a fresh box always gets it.
#     Layer 3 — cloud-init user-data snippet (/etc/cloud/cloud.cfg.d/99-oper-keys.cfg)
#               Re-applies the key on every cloud-init run (boot/rebuild).
#               ssh_deletekeys: false guarantees cloud-init never wipes it.
#
# Invocation model (runs ON the prod box AS root, safer to run from anywhere):
#   From the operator's mac:
#     ssh root@<ip> 'bash -s' < ops/resilience/persist-ssh-key.sh
#     ssh root@<ip> 'OPER_DEPLOY_PUBKEY="$KEY" bash -s' < ops/resilience/persist-ssh-key.sh
#   Or directly on the box as root:
#     ./ops/resilience/persist-ssh-key.sh
#
# Key resolution (keep the real key OUT of git):
#   1. $OPER_DEPLOY_PUBKEY env var (preferred; piped over ssh).
#   2. Fallback: ~/.ssh/id_onepercent.pub on the operator's machine.
#   Fails with a clear error if neither yields a key.
#
# Idempotent: safe to re-run. No args. Exit 0 on success, non-zero on real
# failure (missing key source, upctl auth error). Prints OK/SKIP/UPDATED
# after each layer.
#
# Requirements: bash, ssh-keygen (layer 1), upctl (layer 2; skipped with
# warning if absent), cloud-init (layer 3; validation skipped with warning
# if the binary is absent).

set -euo pipefail

# ---------------------------------------------------------------------------
# Key resolution
# ---------------------------------------------------------------------------

resolve_key() {
  local key=""
  if [[ -n "${OPER_DEPLOY_PUBKEY:-}" ]]; then
    key="${OPER_DEPLOY_PUBKEY}"
  elif [[ -f "${HOME}/.ssh/id_onepercent.pub" ]]; then
    key="$(cat "${HOME}/.ssh/id_onepercent.pub")"
  fi

  # Trim and sanity-check.
  key="$(printf '%s' "$key" | tr -d '\r\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

  if [[ -z "$key" ]]; then
    echo "ERROR: no deploy pubkey provided." >&2
    echo "Set OPER_DEPLOY_PUBKEY or create ~/.ssh/id_onepercent.pub" >&2
    return 1
  fi

  # Must look like an OpenSSH public key (starts with ssh-... or ecdsa-.../sk-...).
  if ! printf '%s' "$key" | grep -Eq '^(ssh-(rsa|dss|ed25519|ecdsa)|ecdsa-sha2-|sk-(ssh|ecdsa)-)'; then
    echo "ERROR: resolved key does not look like an OpenSSH public key." >&2
    echo "First token was: $(printf '%s' "$key" | awk '{print $1}')" >&2
    return 1
  fi

  printf '%s' "$key"
}

# Extract the key BODY (type + base64, no comment) for dedup matching.
key_body() {
  # "$1" = full key line
  printf '%s' "$1" | awk '{print $1 " " $2}'
}

# ---------------------------------------------------------------------------
# Layer 1 — authorized_keys
# ---------------------------------------------------------------------------

layer_authorized_keys() {
  local key="$1"
  local ssh_dir="/root/.ssh"
  local auth_file="${ssh_dir}/authorized_keys"

  local status="OK"

  if [[ ! -d "$ssh_dir" ]]; then
    mkdir -p "$ssh_dir"
    status="UPDATED"
  fi
  chmod 700 "$ssh_dir"

  if [[ ! -f "$auth_file" ]]; then
    : > "$auth_file"
    status="UPDATED"
  fi
  chmod 600 "$auth_file"

  local body
  body="$(key_body "$key")"

  # Match on key body (type + base64), ignoring the comment so a re-run
  # with a different comment does not duplicate the line.
  if grep -EqF -- "$body" "$auth_file" 2>/dev/null; then
    : # already present
  else
    printf '%s\n' "$key" >> "$auth_file"
    status="UPDATED"
  fi

  # Re-assert perms (idempotent).
  chmod 700 "$ssh_dir"
  chmod 600 "$auth_file"

  echo "Layer 1 (authorized_keys): ${status}"
}

# ---------------------------------------------------------------------------
# Layer 2 — UpCloud stored SSH key via upctl
# ---------------------------------------------------------------------------

layer_upcloud() {
  local key="$1"
  local name="onepercent-deploy-202606"

  if ! command -v upctl >/dev/null 2>&1; then
    echo "Layer 2 (upcloud ssh-key): SKIP (upctl not installed on this host)"
    return 0
  fi

  # Make sure upctl is actually authenticated; an auth error is a real failure.
  if ! upctl ssh-key list >/dev/null 2>&1; then
    echo "ERROR (layer 2): 'upctl ssh-key list' failed — check upctl auth." >&2
    return 1
  fi

  # Does a key with this name already exist?
  if upctl ssh-key list 2>/dev/null | grep -Eq "(^|\s)${name}(\s|$)"; then
    # Key exists. Verify the stored body matches; if not, delete+recreate.
    local stored
    stored="$(upctl ssh-key list 2>/dev/null | awk -v n="$name" '$0 ~ n {print $NF}' | head -n1)"
    # The list output is human-readable; compare bodies defensively.
    local body_stored body_local
    body_stored="$(printf '%s' "$stored" | awk '{print $1 " " $2}')"
    body_local="$(key_body "$key")"

    if [[ "$body_stored" == "$body_local" ]]; then
      echo "Layer 2 (upcloud ssh-key): SKIP (already stored, body matches)"
      return 0
    fi

    # Mismatch: delete and recreate so the stored key tracks the real one.
    if ! upctl ssh-key delete "$name" >/dev/null 2>&1; then
      echo "ERROR (layer 2): stored key body mismatch and delete failed." >&2
      return 1
    fi
    if ! upctl ssh-key create --name "$name" --ssh-key "$key" >/dev/null 2>&1; then
      echo "ERROR (layer 2): recreate after delete failed." >&2
      return 1
    fi
    echo "Layer 2 (upcloud ssh-key): UPDATED (body mismatch → delete+recreate)"
    return 0
  fi

  # Not present: create.
  if upctl ssh-key create --name "$name" --ssh-key "$key" >/dev/null 2>&1; then
    echo "Layer 2 (upcloud ssh-key): UPDATED (created)"
    return 0
  fi

  # Race / unknown error. Re-check: maybe another process created it concurrently.
  if upctl ssh-key list 2>/dev/null | grep -Eq "(^|\s)${name}(\s|$)"; then
    echo "Layer 2 (upcloud ssh-key): SKIP (create lost a race but key now present)"
    return 0
  fi
  echo "ERROR (layer 2): 'upctl ssh-key create' failed and key is not present." >&2
  return 1
}

# ---------------------------------------------------------------------------
# Layer 3 — cloud-init user-data snippet
# ---------------------------------------------------------------------------

layer_cloud_init() {
  local key="$1"
  local cfg_dir="/etc/cloud/cloud.cfg.d"
  local cfg_file="${cfg_dir}/99-oper-keys.cfg"

  local snippet
  # Build the snippet with the real key expanded. Heredoc with variable
  # expansion on, but the cloud-init keys are literal snake_case.
  snippet="$(cat <<EOF
ssh_authorized_keys:
  - ${key}
ssh_deletekeys: false
preserve_hostname: true
EOF
)"

  local status="OK"
  if [[ ! -f "$cfg_file" ]] || [[ "$(cat "$cfg_file")" != "$snippet" ]]; then
    mkdir -p "$cfg_dir"
    printf '%s\n' "$snippet" > "$cfg_file"
    chmod 644 "$cfg_file"
    status="UPDATED"
  fi
  chmod 644 "$cfg_file"

  # Validate only if cloud-init binary is present. The prod box may have it
  # but the operator's mac (if run there by mistake) likely will not.
  if command -v cloud-init >/dev/null 2>&1; then
    if ! cloud-init schema --config-file "$cfg_file" >/dev/null 2>&1; then
      echo "ERROR (layer 3): cloud-init schema validation failed for $cfg_file" >&2
      return 1
    fi
  else
    echo "Layer 3 (cloud-init): ${status} (validation skipped — cloud-init binary absent)"
    return 0
  fi

  echo "Layer 3 (cloud-init): ${status}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  local key
  key="$(resolve_key)" || return 1

  layer_authorized_keys "$key"
  layer_upcloud "$key"
  layer_cloud_init "$key"

  echo "persist-ssh-key: done (key fingerprint: $(ssh-keygen -l -f <(printf '%s\n' "$key") | awk '{print $1" "$2}'))"
}

main "$@"
