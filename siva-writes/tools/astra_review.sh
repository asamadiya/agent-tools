#!/usr/bin/env bash
# Drive gpt-6-astra as an independent reviewer of the skill.
#
# Three things here are deliberate.
#
# --session-id with a fresh uuid every round. copilot resumes silently when it can, and a resumed
# reviewer that has already argued for a position defends it instead of re-reading the file. Each
# round must meet the skill cold.
#
# Output captured to a file. The reviewer paints into an alternate screen buffer, and scrollback
# does not survive it; findings read on screen and never written down have been lost before.
#
# The round-N prompt asks the reviewer to classify the previous round's repairs rather than just
# re-review. "Discharged but broken" is a verdict that only exists if you ask for it, and it is
# where repairs actually fail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUND="${1:?usage: astra_review.sh <round> <prompt-file>}"
PROMPT_FILE="${2:?usage: astra_review.sh <round> <prompt-file>}"
OUT="$ROOT/reports/astra-round-$ROUND.md"
SID="$(python3 -c 'import uuid;print(uuid.uuid4())')"

mkdir -p "$ROOT/reports"
{
  echo "<!-- model: gpt-6-astra  effort: max  context: long_context  session: $SID -->"
  echo "<!-- prompt: $PROMPT_FILE -->"
  echo
} > "$OUT"

echo "astra round $ROUND  session=$SID  -> $OUT" >&2
copilot \
  --model gpt-6-astra \
  --reasoning-effort max \
  --context long_context \
  --session-id "$SID" \
  --allow-all-tools \
  --silent \
  -p "$(cat "$PROMPT_FILE")" 2>&1 | tee -a "$OUT"

echo >&2
echo "captured $(wc -l < "$OUT") lines to $OUT" >&2
