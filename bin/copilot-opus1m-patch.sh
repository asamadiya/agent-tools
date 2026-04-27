#!/usr/bin/env bash
# Unhide claude-opus-4.6-1m from the Copilot CLI /model picker.
# The CLI hardcodes an exclusion set (Hdt) that hides "internal only" models.
# This patch removes opus-4.6-1m from that set.
#
# Idempotent — safe to run on every copilot launch.

set -euo pipefail

PKG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal"
VER=$(copilot --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+')
APP="$PKG_DIR/$VER/app.js"

[[ -f "$APP" ]] || exit 0

if grep -q 'new Set(\["claude-opus-4.6-1m"' "$APP" 2>/dev/null; then
  sed -i 's/new Set(\["claude-opus-4.6-1m","goldeneye"\])/new Set(["goldeneye"])/' "$APP"
fi
