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
#
# Diagnostics: pass -v / --verbose for stderr trace of which path won and
# how many matches were found. Useful when debugging a box where the patch
# silently no-ops (different cache root, different bundle layout, copilot
# never launched yet so app.js hasn't been extracted, etc.).

set -euo pipefail

VERBOSE=0
case "${1:-}" in
  -v|--verbose) VERBOSE=1 ;;
esac
log() { (( VERBOSE )) && printf '[opus1m-patch] %s\n' "$*" >&2 || true; }

# Try to detect copilot's version. `copilot --version` typically prints
# something like "GitHub Copilot CLI 1.0.40." but some installs may differ.
# Fall back to whatever 3-segment number we can grep, regardless of locale.
VER=""
if command -v copilot >/dev/null 2>&1; then
  raw=$(copilot --version 2>/dev/null || true)
  VER=$(printf '%s' "$raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
  log "copilot --version raw: $raw"
  log "detected version: ${VER:-(none)}"
fi

# Candidate locations for the unpacked bundle, most likely first.
CANDIDATES=()
[[ -n "$VER" ]] && CANDIDATES+=(
  "${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal/$VER/app.js"
  "$HOME/.cache/copilot/pkg/universal/$VER/app.js"
)
# Glob-fallback: pick the newest app.js anywhere under the copilot pkg root,
# regardless of detected version (handles a box where `copilot --version`
# is shaped weirdly or cached version dirs from prior installs co-exist).
shopt -s nullglob
for d in \
  "${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal"/*/app.js \
  "$HOME/.cache/copilot/pkg/universal"/*/app.js \
  "$HOME/.local/share/copilot/pkg/universal"/*/app.js
do
  CANDIDATES+=("$d")
done

APP=""
for c in "${CANDIDATES[@]}"; do
  [[ -f "$c" ]] || { log "miss: $c"; continue; }
  APP="$c"
  log "hit:  $APP"
  break
done

if [[ -z "$APP" ]]; then
  log "no app.js found in any candidate path."
  log "If copilot has never been launched on this box, run \`copilot --version\` once first to extract the bundle."
  exit 0
fi

python3 - "$APP" "$VERBOSE" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
verbose = sys.argv[2] == "1"
src = p.read_text()

stripped = 0

def fix(m: re.Match) -> str:
    global stripped
    body = m.group(1)
    if '"goldeneye"' not in body:
        return m.group(0)
    new_body, n = re.subn(r'"claude-opus-[^"]+",?', '', body)
    new_body = re.sub(r',+', ',', new_body).strip(',')
    stripped += n
    return f'new Set([{new_body}])'

new = re.sub(r'new Set\(\[([^\]]*)\]\)', fix, src)
if new != src:
    p.write_text(new)
    if verbose:
        print(f"[opus1m-patch] patched: {stripped} entries removed from {p}", file=sys.stderr)
else:
    if verbose:
        print(f"[opus1m-patch] no-op: nothing to strip in {p}", file=sys.stderr)
PY
