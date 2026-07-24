#!/usr/bin/env bash
# =============================================================================
# ops-lint.sh — static checks for ops/ shell scripts and systemd units.
# Runs identically in CI and locally:  bash ops/ci/ops-lint.sh
#
# Exists because green unit tests say nothing about deploy-time correctness.
# On 2026-07-24 three ops defects reached production; checks 1–3 below are the
# static half of the net (the deploy preflight is the runtime half):
#
#   1. shellcheck (error severity) over every ops/**/*.sh
#   2. systemd-analyze verify over every ops/systemd/*.service|*.timer
#   3. systemd-run scope-property allowlist — catches `-p Nice=10`, which is
#      NOT valid on a transient scope and silently aborted every deploy's
#      build step ("Unknown assignment: Nice=10") for hours.
#
# --self-test runs the checks against ops/ci/fixtures/ and PASSES only if each
# known-bad fixture is caught (so the linter itself cannot silently rot).
# =============================================================================
set -uo pipefail   # deliberately NOT -e: collect every failure, report once

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/ops/ci/fixtures"
SELF_TEST=false
[[ "${1:-}" == "--self-test" ]] && SELF_TEST=true

FAILED=0
red()  { printf "\033[1;31m%s\033[0m\n" "$*"; }
grn()  { printf "\033[1;32m%s\033[0m\n" "$*"; }
ylw()  { printf "\033[1;33m%s\033[0m\n" "$*"; }
note() { printf "\033[1;34m[lint]\033[0m %s\n" "$*"; }

# Scope units accept ONLY cgroup resource-control properties. Anything from the
# exec context (Nice, User, WorkingDirectory, Environment, …) is rejected at
# runtime with "Unknown assignment", which aborts the caller.
SCOPE_ALLOWED_RE='^(Memory(Max|High|Low|Min|SwapMax|Accounting)|CPU(Quota|Weight|Shares|Accounting)|IO(Weight|Accounting|ReadBandwidthMax|WriteBandwidthMax)|Tasks(Max|Accounting)|Slice|Delegate|AllowedCPUs|AllowedMemoryNodes)$'

# ---------------------------------------------------------------------------
# 1. shellcheck
# ---------------------------------------------------------------------------
lint_shell() {
  local -a files=("$@")
  [[ ${#files[@]} -eq 0 ]] && return 0
  if ! command -v shellcheck >/dev/null 2>&1; then
    ylw "  shellcheck not installed — skipping (CI installs it)"
    return 0
  fi
  # Error severity only: warnings/infos are advisory, errors are real defects.
  if shellcheck -S error -x "${files[@]}"; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# 2. systemd unit verification
# ---------------------------------------------------------------------------
lint_units() {
  local -a units=("$@")
  [[ ${#units[@]} -eq 0 ]] && return 0
  if ! command -v systemd-analyze >/dev/null 2>&1; then
    ylw "  systemd-analyze not available — skipping unit verify"
    return 0
  fi
  local rc=0 out
  for u in "${units[@]}"; do
    # systemd-analyze verify also reports environment-specific noise that is
    # expected off-box: binaries not installed on the runner, users that only
    # exist on prod, and unit deps outside this directory. Those are not
    # syntax defects, so filter them and fail only on the rest.
    out="$(systemd-analyze verify "$u" 2>&1 \
      | grep -vE "Command .* is not executable|Executable path is not absolute|Unit .* not found|Failed to (resolve|load) unit|User or group .* not found|special user|Ignoring|/usr/(bin|sbin)/.* does not exist" \
      || true)"
    if [[ -n "$out" ]]; then
      red "  $u"
      printf '%s\n' "$out" | sed 's/^/      /'
      rc=1
    fi
  done
  return $rc
}

# ---------------------------------------------------------------------------
# 3. systemd-run scope properties (the `-p Nice=10` regression)
# ---------------------------------------------------------------------------
lint_scope_props() {
  local -a files=("$@")
  [[ ${#files[@]} -eq 0 ]] && return 0
  local rc=0
  for f in "${files[@]}"; do
    # Never scan this linter: it necessarily contains the very patterns
    # (and example messages) that it searches for.
    [[ "$(basename "$f")" == "ops-lint.sh" ]] && continue
    # Strip comments first — a `-p Nice=` mentioned in documentation is not a
    # real invocation, and flagging it would train people to ignore the check.
    local body
    body="$(sed 's/[[:space:]]*#.*$//' "$f")"
    printf '%s' "$body" | grep -q -- '--scope' || continue
    # Collect every -p NAME=... on the systemd-run invocation (it may be split
    # across continuation lines, so scan a small window after the match).
    local props
    props="$(printf '%s' "$body" | awk '/systemd-run/,/[^\\]$/' | grep -oE '\-p +[A-Za-z]+=' | sed -E 's/-p +//; s/=$//' | sort -u)"
    while read -r prop; do
      [[ -z "$prop" ]] && continue
      if ! [[ "$prop" =~ $SCOPE_ALLOWED_RE ]]; then
        red "  $f: '-p ${prop}=' is not a valid transient SCOPE property"
        echo "      scopes accept cgroup resource-control properties only;"
        echo "      systemd rejects the rest at runtime (\"Unknown assignment: ${prop}=…\")."
        echo "      For exec-context settings wrap the command instead (e.g. nice/ionice)."
        rc=1
      fi
    done <<< "$props"
  done
  return $rc
}

# ---------------------------------------------------------------------------
# Self-test: every fixture must be CAUGHT
# ---------------------------------------------------------------------------
if $SELF_TEST; then
  note "self-test — each fixture must FAIL its check"
  ok=0; expected=0

  # bad.sh fixture (exercised only when the shellcheck binary exists)
  if command -v shellcheck >/dev/null 2>&1; then
    expected=$((expected+1))
    lint_shell "$FIXTURE_DIR/bad.sh" >/dev/null 2>&1 \
      || { grn "  caught bad.sh (shellcheck)"; ok=$((ok+1)); }
  else
    ylw "  shellcheck absent — bad.sh fixture not exercised"
  fi

  # unit-verify fixture (systemd only — absent on macOS dev machines, present in CI)
  if command -v systemd-analyze >/dev/null 2>&1; then
    expected=$((expected+1))
    lint_units "$FIXTURE_DIR/bad.service" >/dev/null 2>&1 \
      || { grn "  caught bad.service (unit verify)"; ok=$((ok+1)); }
  else
    ylw "  systemd-analyze absent (non-Linux) — bad.service fixture not exercised"
  fi

  # scope-property fixture is pure text analysis — always exercised.
  expected=$((expected+1))
  lint_scope_props "$FIXTURE_DIR/bad-scope.sh" >/dev/null 2>&1 \
    || { grn "  caught bad-scope.sh (scope props)"; ok=$((ok+1)); }

  if [[ $ok -lt $expected ]]; then
    red "SELF-TEST FAILED: only $ok/$expected exercisable fixtures were caught — the linter has rotted."
    exit 1
  fi
  grn "SELF-TEST PASSED: $ok/$expected exercisable fixtures caught"
  exit 0
fi

# ---------------------------------------------------------------------------
# Normal run — everything in ops/, excluding the deliberately-broken fixtures
# ---------------------------------------------------------------------------
# Portable collection (macOS ships bash 3.2, which has no `mapfile`) so this
# script behaves identically on a dev laptop and on the CI runner.
SH_FILES=()
while IFS= read -r f; do SH_FILES+=("$f"); done < <(
  find "$REPO_ROOT/ops" -name '*.sh' -not -path '*/fixtures/*' | sort
)
UNIT_FILES=()
while IFS= read -r f; do UNIT_FILES+=("$f"); done < <(
  find "$REPO_ROOT/ops/systemd" \( -name '*.service' -o -name '*.timer' \) -not -path '*/fixtures/*' | sort
)

note "shellcheck (${#SH_FILES[@]} scripts)"
lint_shell "${SH_FILES[@]}" && grn "  ok" || { FAILED=1; red "  FAILED"; }

note "systemd unit verify (${#UNIT_FILES[@]} units)"
lint_units "${UNIT_FILES[@]}" && grn "  ok" || { FAILED=1; red "  FAILED"; }

note "systemd-run scope properties"
lint_scope_props "${SH_FILES[@]}" && grn "  ok" || { FAILED=1; red "  FAILED"; }

echo ""
if [[ $FAILED -ne 0 ]]; then
  red "ops-lint FAILED"
  exit 1
fi
grn "ops-lint passed"
