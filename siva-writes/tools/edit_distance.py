#!/usr/bin/env python3
"""Metric 3: expert edit distance.

This is the metric that says whether the skill saves you time or only hides tells. A document that
wins on preference and needs the same amount of rewriting has moved the tells somewhere you stopped
noticing them.

Three subcommands.

  stage      copy N outputs per condition into eval/edits/<condition>/, with condition identity
             stripped from the filename, so you edit blind
  score      diff edited against original, report % tokens changed per condition
  classify   label each changed hunk against the LAMP taxonomy (arXiv 2409.14509, section 4.4)

You edit in vim. `stage` writes a shuffled manifest mapping opaque ids back to conditions, and does
not print it: knowing that a file came from the full skill while editing it is the same
self-fulfilling problem the blind pairwise judge exists to avoid.

Classification is proposed by a different-family model and written to a file you can correct. The
label is a judgement about why an edit was made, and only the person who made it actually knows.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import pathlib
import random
import re
import subprocess
import sys
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVAL = ROOT / "eval"
EDITS = EVAL / "edits"
SEED = 20260918
CLASSIFIER_MODEL = "gemini-3.8-flash"

# arXiv 2409.14509 section 4.4, verbatim category names.
TAXONOMY = [
    "Cliche",
    "Unnecessary/Redundant Exposition",
    "Purple Prose",
    "Poor Sentence Structure",
    "Lack of Specificity and Detail",
    "Awkward Word Choice and Phrasing",
    "Tense Inconsistency",
]


def tokens(text: str) -> list[str]:
    return re.findall(r"\S+", text)


def cmd_stage(args) -> None:
    rng = random.Random(SEED)
    root = pathlib.Path(args.outputs)
    conditions = sorted(p.name for p in root.iterdir() if p.is_dir())
    shared = sorted(set.intersection(*[{p.stem for p in (root / c).glob("*.txt")} for c in conditions]))
    rng.shuffle(shared)
    picked = shared[: args.n]

    EDITS.mkdir(parents=True, exist_ok=True)
    (EDITS / "original").mkdir(exist_ok=True)
    (EDITS / "edited").mkdir(exist_ok=True)
    manifest = []
    for bid in picked:
        for cond in conditions:
            src = root / cond / f"{bid}.txt"
            if not src.exists():
                continue
            opaque = hashlib.sha256(f"{SEED}{cond}{bid}".encode()).hexdigest()[:10]
            (EDITS / "original" / f"{opaque}.txt").write_text(src.read_text(encoding="utf-8"))
            (EDITS / "edited" / f"{opaque}.txt").write_text(src.read_text(encoding="utf-8"))
            manifest.append({"opaque": opaque, "condition": cond, "brief_id": bid})
    (EDITS / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f'staged {len(manifest)} documents, {args.n} briefs x {len(conditions)} conditions')
    print(f'\n  edit in place:   vim {EDITS}/edited/*.txt')
    print(f'  originals kept:  {EDITS}/original/')
    print(f'\nEdit each to the standard you would publish. Do not look at manifest.json until you are')
    print(f'done - the mapping back to conditions is deliberately not printed here.')
    print(f'\nthen:  python3 tools/edit_distance.py score')


def cmd_score(args) -> None:
    manifest = json.loads((EDITS / "manifest.json").read_text())
    rows, by_condition = [], {}
    for m in manifest:
        a = (EDITS / "original" / f'{m["opaque"]}.txt').read_text(encoding="utf-8")
        b = (EDITS / "edited" / f'{m["opaque"]}.txt').read_text(encoding="utf-8")
        ta, tb = tokens(a), tokens(b)
        sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
        changed = sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal")
        pct = 100 * changed / max(1, len(ta))
        hunks = [{"tag": tag, "before": " ".join(ta[i1:i2]), "after": " ".join(tb[j1:j2])}
                 for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != "equal"]
        rows.append({**m, "tokens_original": len(ta), "tokens_changed": changed,
                     "pct_changed": round(pct, 2), "n_hunks": len(hunks), "hunks": hunks})
        by_condition.setdefault(m["condition"], []).append(pct)

    edited_any = [r for r in rows if r["tokens_changed"] > 0]
    summary = {}
    for cond, pcts in sorted(by_condition.items()):
        n = len(pcts)
        mean = sum(pcts) / n
        sd = (sum((p - mean) ** 2 for p in pcts) / max(1, n - 1)) ** 0.5
        summary[cond] = {"documents": n, "mean_pct_tokens_changed": round(mean, 2),
                         "sd": round(sd, 2), "median": round(sorted(pcts)[n // 2], 2)}

    (EVAL / "results-metric3.json").write_text(json.dumps(
        {"taxonomy_source": "arXiv 2409.14509 section 4.4",
         "documents_edited": len(edited_any), "documents_staged": len(rows),
         "status": "COMPLETE" if len(edited_any) == len(rows) else
                   f"PARTIAL - {len(rows) - len(edited_any)} of {len(rows)} staged documents are unedited",
         "by_condition": summary, "rows": rows}, indent=2))

    if not edited_any:
        print("NOT RUN. Every staged document is byte-identical to its original, so nothing has been")
        print("edited yet. The harness works; the metric needs a human.")
        return
    print(f'{"condition":12s}{"docs":>6s}{"mean %":>9s}{"sd":>8s}{"median":>9s}')
    for cond, s in summary.items():
        print(f'{cond:12s}{s["documents"]:6d}{s["mean_pct_tokens_changed"]:9.2f}{s["sd"]:8.2f}{s["median"]:9.2f}')
    if len(edited_any) < len(rows):
        print(f'\nPARTIAL: {len(rows) - len(edited_any)} of {len(rows)} documents are unedited and score 0%,')
        print('which drags every condition mean toward zero. Finish them or drop them.')


def cmd_classify(args) -> None:
    data = json.loads((EVAL / "results-metric3.json").read_text())
    out = []
    for row in data["rows"]:
        if not row["hunks"]:
            continue
        listing = "\n".join(
            f'{i}. BEFORE: {h["before"][:200]!r}\n   AFTER:  {h["after"][:200]!r}'
            for i, h in enumerate(row["hunks"][:40], 1))
        prompt = (
            "A professional editor made these edits to a technical document. Label each edit with "
            "exactly one category from this taxonomy:\n\n"
            + "\n".join(f"  - {t}" for t in TAXONOMY)
            + "\n\nIf an edit fits none of them, label it Other.\n"
              "Answer one line per edit: '<number>. <category>'. No explanation.\n\n" + listing)
        try:
            proc = subprocess.run(
                ["copilot", "--model", CLASSIFIER_MODEL, "--reasoning-effort", "low",
                 "--session-id", str(uuid.uuid4()), "--allow-all-tools", "--silent", "-p", prompt],
                capture_output=True, text=True, timeout=420)
            text = proc.stdout or ""
        except subprocess.TimeoutExpired:
            text = ""
        labels = {}
        for line in text.splitlines():
            m = re.match(r"\s*(\d+)[.)]\s*(.+)", line)
            if m:
                labels[int(m.group(1))] = m.group(2).strip()
        for i, h in enumerate(row["hunks"][:40], 1):
            out.append({"opaque": row["opaque"], "condition": row["condition"], "hunk": i,
                        "before": h["before"][:200], "after": h["after"][:200],
                        "proposed_label": labels.get(i, "UNLABELLED")})
        print(f'{row["opaque"]}  {len(labels)}/{min(len(row["hunks"]), 40)} labelled', file=sys.stderr)

    path = EVAL / "results-metric3-labels.json"
    path.write_text(json.dumps({
        "classifier_model": CLASSIFIER_MODEL,
        "status": "PROPOSED. These labels were produced by a model, not by the editor. Only the "
                  "person who made an edit knows why. Correct this file before quoting it.",
        "taxonomy": TAXONOMY, "labels": out}, indent=2))
    counts = {}
    for o in out:
        counts.setdefault(o["condition"], {}).setdefault(o["proposed_label"], 0)
        counts[o["condition"]][o["proposed_label"]] += 1
    print(json.dumps(counts, indent=2))
    print(f'\n-> {path}  (PROPOSED labels, correct before quoting)')


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stage"); s.add_argument("--outputs", default=str(EVAL / "outputs")); s.add_argument("--n", type=int, default=10); s.set_defaults(fn=cmd_stage)
    c = sub.add_parser("score"); c.set_defaults(fn=cmd_score)
    l = sub.add_parser("classify"); l.set_defaults(fn=cmd_classify)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
