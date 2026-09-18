#!/usr/bin/env bash
# Install the skill into ~/.claude/skills/siva-writes as a symlink, after validating it.
#
# A symlink is the point: the user asked to run the improved skill between rounds rather than wait
# for delivery, so every commit to skill/ is live the moment it lands. That is also the risk, since
# a broken intermediate state is live too. Hence the checks below run BEFORE the swap, and the
# script refuses to install rather than leaving a half-written skill in place.
#
# The first install moves any existing real directory to a timestamped backup instead of deleting
# it. v0 is also committed to the repo under baseline/, so the pre-change skill survives in two
# places and neither depends on this script being correct.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/skill"
DEST="$HOME/.claude/skills/siva-writes"
fail=0

say() { printf '%-58s %s\n' "$1" "$2"; }

# --- frontmatter must parse and carry name + description, or the skill never triggers.
python3 - "$SRC/SKILL.md" <<'PY' || fail=1
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
if not m:
    print("  FAIL  no YAML frontmatter block"); sys.exit(1)
fm = m.group(1)
for key in ("name:", "description:"):
    if key not in fm:
        print(f"  FAIL  frontmatter missing {key}"); sys.exit(1)
name = re.search(r"^name:\s*(\S+)", fm, re.M)
if not name or name.group(1) != "siva-writes":
    print("  FAIL  frontmatter name is not siva-writes"); sys.exit(1)
lines = len(text.splitlines())
print(f"  ok    frontmatter parses, {lines} lines", "(OVER 400 BUDGET)" if lines > 400 else "")
PY
say "frontmatter" "$([ $fail -eq 0 ] && echo ok || echo FAIL)"

# --- every path SKILL.md points at must exist. A reference to a file that is not there is a
# --- pointer the reader follows into nothing, and it fails silently at read time.
missing=0
while IFS= read -r ref; do
  [ -e "$SRC/$ref" ] || { echo "  FAIL  referenced but absent: $ref"; missing=1; }
done < <(grep -oE '`(references|scripts)/[A-Za-z0-9._/-]+`' "$SRC/SKILL.md" | tr -d '`' | sort -u)
[ $missing -eq 0 ] || fail=1
say "referenced files exist" "$([ $missing -eq 0 ] && echo ok || echo FAIL)"

# --- the gate must run, and must still pass the exemplars on the measured axes.
if python3 "$SRC/scripts/prose-check.py" "$SRC/references/exemplars/aws-timeouts-retries-backoff-jitter.txt" >/dev/null 2>&1; then
  say "gate runs and passes a human exemplar" "ok"
else
  say "gate runs and passes a human exemplar" "FAIL"; fail=1
fi

# --- negative-set patterns must all compile, or the gate crashes on a document mid-check.
python3 - "$SRC/references/negative-set.json" <<'PY' || fail=1
import json, re, sys
spec = json.load(open(sys.argv[1]))
bad = []
for tier in ("tier1", "tier2"):
    for p in spec.get(tier, []):
        if p.get("regex"):
            try: re.compile(p["regex"])
            except re.error as e: bad.append((p["name"], str(e)))
if bad:
    for n, e in bad: print(f"  FAIL  regex {n}: {e}")
    sys.exit(1)
print(f'  ok    {len(spec.get("tier1", []))} tier-1 and {len(spec.get("tier2", []))} tier-2 patterns compile')
PY
say "negative-set regexes compile" "$([ $fail -eq 0 ] && echo ok || echo FAIL)"

if [ $fail -ne 0 ]; then
  echo
  echo "REFUSING to install. The currently installed skill is untouched."
  exit 1
fi

mkdir -p "$HOME/.claude/skills"
if [ -e "$DEST" ] && [ ! -L "$DEST" ]; then
  BACKUP="$DEST.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$DEST" "$BACKUP"
  echo
  echo "existing real directory moved to $BACKUP"
fi
ln -sfn "$SRC" "$DEST"

echo
echo "installed: $DEST -> $(readlink -f "$DEST")"
echo "SKILL.md   $(wc -l < "$SRC/SKILL.md") lines"
echo "commit     $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'not a repo')"
echo
echo "This is a symlink. Every commit to skill/ is live immediately, including a bad one;"
echo "re-run this script after any change so the checks above gate the swap."
