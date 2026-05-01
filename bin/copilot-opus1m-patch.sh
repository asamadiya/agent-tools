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
# Two layouts in the wild:
#   - new (XDG):   ~/.cache/copilot/pkg/universal/<ver>/app.js  (newer hosts)
#   - legacy:      ~/.copilot/pkg/universal/<ver>/app.js        (pre-XDG hosts)
# `copilot` itself probes both, so we need to as well — strace confirms.
CANDIDATES=()
[[ -n "$VER" ]] && CANDIDATES+=(
  "${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal/$VER/app.js"
  "$HOME/.cache/copilot/pkg/universal/$VER/app.js"
  "$HOME/.copilot/pkg/universal/$VER/app.js"
)
# Glob-fallback: pick any app.js anywhere under any known copilot pkg root,
# regardless of detected version (handles a box where `copilot --version`
# is shaped weirdly or cached version dirs from prior installs co-exist).
shopt -s nullglob
for d in \
  "${XDG_CACHE_HOME:-$HOME/.cache}/copilot/pkg/universal"/*/app.js \
  "$HOME/.cache/copilot/pkg/universal"/*/app.js \
  "$HOME/.copilot/pkg/universal"/*/app.js \
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
import json, os, pathlib, re, sys
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
        print(f"[opus1m-patch] picker: stripped {stripped} entries from {p}", file=sys.stderr)
elif verbose:
    print(f"[opus1m-patch] picker: no-op on {p}", file=sys.stderr)

# --- Default model + reasoning effort ---------------------------------------
# Make `claude-opus-4.7-1m-internal` + effortLevel `xhigh` the default in
# ~/.copilot/settings.json. This is the "1m context, extra-high reasoning"
# combo: there's no single model id that bundles both, but Copilot CLI lets
# you pick the 1m model and set the reasoning effort independently. Override
# with COPILOT_DEFAULT_MODEL / COPILOT_DEFAULT_EFFORT env vars if needed.
desired_model = os.environ.get("COPILOT_DEFAULT_MODEL", "claude-opus-4.7-1m-internal")
desired_effort = os.environ.get("COPILOT_DEFAULT_EFFORT", "xhigh")
settings_path = pathlib.Path.home() / ".copilot" / "settings.json"
if settings_path.exists():
    try:
        s = json.loads(settings_path.read_text())
        changes = []
        if s.get("model") != desired_model:
            s["model"] = desired_model
            changes.append(f"model -> {desired_model}")
        if s.get("effortLevel") != desired_effort:
            s["effortLevel"] = desired_effort
            changes.append(f"effortLevel -> {desired_effort}")
        if changes:
            settings_path.write_text(json.dumps(s, indent=2) + "\n")
            if verbose:
                print(f"[opus1m-patch] settings: {', '.join(changes)}", file=sys.stderr)
        elif verbose:
            print(f"[opus1m-patch] settings: already {desired_model} / {desired_effort}", file=sys.stderr)
    except json.JSONDecodeError as e:
        if verbose:
            print(f"[opus1m-patch] settings: skipped (invalid JSON in {settings_path}: {e})", file=sys.stderr)
elif verbose:
    print(f"[opus1m-patch] settings: skipped (no {settings_path})", file=sys.stderr)
PY
