#!/usr/bin/env bash
# The evaluation, end to end. Every step is idempotent; the frozen eval is never rebuilt by this
# script, because rebuilding it would invalidate comparison with every result already computed.
#
# Generation is the one step this cannot do alone: conditions A-D are written by Claude with and
# without the skill, which runs through the Workflow harness in tools/generate_workflow.js. The
# metrics below all run against whatever is in eval/outputs/.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== corpus and measurement =========================================="
python3 tools/fetch_corpus.py          # idempotent; re-fetches only what is missing or FAILED
python3 tools/measure.py --splits train

echo
echo "== generation ======================================================"
echo "Conditions A-D are produced by the Workflow harness, not by this script:"
echo "  Workflow({scriptPath: 'tools/generate_workflow.js', args: <[[id,genre,words],...]>})"
echo "Condition H is copied from the frozen briefs' human_span."
for c in A B C D H; do printf "  %s: %3d documents\n" "$c" "$(ls eval/outputs/$c 2>/dev/null | wc -l)"; done

echo
echo "== metric 4: fingerprint (offline) ================================="
python3 tools/fingerprint.py

echo
echo "== construction rates =============================================="
python3 tools/construction_rates.py

echo
echo "== metric 2: comprehension (gemini-3.5-flash, ~200 calls) =========="
python3 tools/comprehension.py --workers 6

echo
echo "== metric 1: pairwise (proxy judge, UNVALIDATED until kappa) ======="
python3 tools/pairwise.py build --n 60
python3 tools/pairwise.py judge --workers 5
echo "Label eval/label-pairs.html, then: python3 tools/pairwise.py kappa ~/Downloads/owner-labels.json"

echo
echo "== metric 3: edit distance (needs the owner) ======================="
python3 tools/edit_distance.py stage --n 10
python3 tools/edit_distance.py score || true

echo
echo "== assemble and verify ============================================="
python3 tools/make_results.py
python3 tools/verify_all.py
