#!/usr/bin/env bash
# Unhide claude-opus-N.M-1m models from the Copilot CLI /model picker.
# The CLI hardcodes an exclusion set anchored on "goldeneye"; this patch
# strips any "claude-opus-N.M-1m" entries from that set so they appear in
# the interactive picker. Catches 4.6-1m today and any future 4.7-1m,
# 5.0-1m, etc. that ship in the same exclusion set.
#
# Idempotent — safe to run on every copilot launch.

set -euo pipefail

PKG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal"
VER=$(copilot --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+')
APP="$PKG_DIR/$VER/app.js"

[[ -f "$APP" ]] || exit 0

if grep -qE 'new Set\(\[("claude-opus-[0-9]+\.[0-9]+-1m",)+"goldeneye"\]\)' "$APP" 2>/dev/null; then
  sed -i -E 's/(new Set\(\[)("claude-opus-[0-9]+\.[0-9]+-1m",)+("goldeneye"\]\))/\1\3/g' "$APP"
fi
