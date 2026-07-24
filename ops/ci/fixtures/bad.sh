#!/usr/bin/env bash
# FIXTURE — deliberately broken. Must be CAUGHT by ops-lint (shellcheck).
# Not executed by anything; excluded from normal lint runs.
set -euo pipefail
# SC1073/SC1009: unterminated if — a hard shellcheck ERROR.
if [ -f /tmp/x ]
  echo "missing then"
fi
