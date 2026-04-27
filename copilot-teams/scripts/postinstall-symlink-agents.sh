#!/usr/bin/env bash
# postinstall-symlink-agents.sh
#
# Symlinks every ~/.claude/agents/*.md into ~/.copilot/agents/ so the same
# subagent personas (researcher, security-reviewer, gsd-*, etc.) are loadable
# via Copilot's --agent <name> flag without maintaining two copies. Existing
# Copilot agent files are left alone unless they're already symlinks pointing
# into ~/.claude/agents/ (in which case they're refreshed).

set -euo pipefail

CLAUDE_DIR="${CLAUDE_AGENTS_DIR:-$HOME/.claude/agents}"
COPILOT_DIR="${COPILOT_AGENTS_DIR:-$HOME/.copilot/agents}"

if [[ ! -d "$CLAUDE_DIR" ]]; then
  echo "no source dir at $CLAUDE_DIR — nothing to symlink" >&2
  exit 0
fi

mkdir -p "$COPILOT_DIR"

linked=0
skipped=0
shopt -s nullglob
for src in "$CLAUDE_DIR"/*.md; do
  base="$(basename "$src")"
  dst="$COPILOT_DIR/$base"
  if [[ -L "$dst" ]]; then
    # Refresh stale symlink
    ln -sfn "$src" "$dst"
    linked=$((linked + 1))
    continue
  fi
  if [[ -e "$dst" ]]; then
    echo "skip: $dst already exists and is not a symlink" >&2
    skipped=$((skipped + 1))
    continue
  fi
  ln -s "$src" "$dst"
  linked=$((linked + 1))
done

echo "linked $linked, skipped $skipped (existing non-symlinks left alone)"
echo "verify with:  copilot --agent <name> -p 'who are you?' --allow-all-tools -s"
