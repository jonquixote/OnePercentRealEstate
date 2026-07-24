#!/usr/bin/env bash
# FIXTURE — regression for the 2026-07-24 deploy outage. Must be CAUGHT.
# `-p Nice=` is an exec-context property and is NOT valid on a transient
# scope; systemd rejects it ("Unknown assignment: Nice=10"), which aborted
# the build step of every deploy silently for hours.
set -euo pipefail
systemd-run --scope -p MemoryMax=6G -p Nice=10 -p IOWeight=50 bash -c 'echo build'
