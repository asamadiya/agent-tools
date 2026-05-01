#!/usr/bin/env bash
# Unhide claude-opus-* internal/1m/high/xhigh/fast models from the Copilot
# CLI /model picker. The CLI keeps a hardcoded exclusion Set anchored on the
# "goldeneye" sentinel; we strip every "claude-opus-..." entry from that one
# specific Set so the variants appear in the interactive picker. Catches:
#
#   - claude-opus-4.6-1m
#   - claude-opus-4.7-1m-internal
#   - claude-opus-4.7-high / -xhigh
#   - claude-opus-4.6-fast
#   - any future claude-opus-N.M-* the same Set picks up
#
# Idempotent — safe to run on every copilot launch. Targeting the surgery
# at "Sets containing goldeneye" keeps it from clobbering the dozens of
# other "claude-opus-..." string occurrences elsewhere in app.js (pricing
# tables, tool catalogs, etc.).

set -euo pipefail

PKG_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal"
VER=$(copilot --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+')
APP="$PKG_DIR/$VER/app.js"

[[ -f "$APP" ]] || exit 0

python3 - "$APP" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()

def fix(m: re.Match) -> str:
    body = m.group(1)
    if '"goldeneye"' not in body:
        return m.group(0)
    new_body = re.sub(r'"claude-opus-[^"]+",?', '', body)
    new_body = re.sub(r',+', ',', new_body).strip(',')
    return f'new Set([{new_body}])'

new = re.sub(r'new Set\(\[([^\]]*)\]\)', fix, src)
if new != src:
    p.write_text(new)
PY
