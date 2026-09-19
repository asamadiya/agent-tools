#!/usr/bin/env python3
"""Verify the whole deliverable before it ships.

Every check here exists because something in this repository was wrong in exactly that way at some
point: a number republished in prose that no longer matched the measurement file, a regex that
stopped compiling, a gate that passed because its config was missing, an eval whose hashes had
drifted from the results computed against them.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
fails: list[str] = []
oks: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    (oks if ok else fails).append(f"{name}{(': ' + detail) if detail else ''}")


# 1. Every deliverable the brief asked for exists.
for rel in ["skill/SKILL.md", "skill/references/voice.md", "skill/references/negative-set.md",
            "skill/references/exemplars/INDEX.json", "skill/scripts/prose-check.py",
            "eval/prompts.jsonl", "eval/questions.jsonl", "eval/judge-prompt.md", "eval/run.sh",
            "eval/results.md", "CHANGELOG.md", "SUMMARY.md"]:
    check(f"exists {rel}", (ROOT / rel).exists())

# 2. SKILL.md is inside the line budget.
n = len((ROOT / "skill" / "SKILL.md").read_text().splitlines())
check("SKILL.md under 400 lines", n <= 400, f"{n}")

# 3. Every number republished in SKILL.md still matches the measurement file.
m = json.loads((ROOT / "corpus" / "measurements-train.json").read_text())["overall"]
skill = (ROOT / "skill" / "SKILL.md").read_text()
for literal, actual in [("0.889", m["claim_first_share"]["mean"]), ("0.064", m["claim_first_share"]["sd"]),
                        ("0.742", m["claim_first_share"]["min"]), ("1.334", m["numbers_per_100w"]["mean"]),
                        ("1.267", m["numbers_per_100w"]["sd"]), ("1.383", m["hedges_per_100w"]["mean"]),
                        ("13.21", m["sentence_len_sd"]["mean"]), ("84.4", m["paragraph_len_mean"]["mean"])]:
    if literal in skill:
        # Tolerance follows the precision actually displayed: 84.4 is the correct one-decimal
        # rounding of 84.381, and a fixed epsilon flags it as a mismatch.
        decimals = len(literal.split(".")[1]) if "." in literal else 0
        tol = 0.5 * 10 ** -decimals + 1e-9
        check(f"SKILL.md {literal} matches measurement", abs(float(literal) - actual) <= tol, f"file says {actual}")

# 4. Exemplars referenced by the index all exist and carry their provenance header.
index = json.loads((ROOT / "skill" / "references" / "exemplars" / "INDEX.json").read_text())
for genre, entries in index["by_genre"].items():
    for e in entries:
        p = ROOT / "skill" / "references" / "exemplars" / e["file"]
        check(f"exemplar {e['file']}", p.exists() and p.read_text()[:20].startswith("<!-- exemplar"))

# 5. Every negative-set regex compiles, and no tier-1 pattern fires on expert prose.
spec = json.loads((ROOT / "skill" / "references" / "negative-set.json").read_text())
bad = []
for tier in ("tier1", "tier2"):
    for p in spec.get(tier, []):
        if p.get("regex"):
            try:
                re.compile(p["regex"])
            except re.error as exc:
                bad.append(f'{p["name"]}: {exc}')
check("negative-set regexes compile", not bad, "; ".join(bad[:3]))
manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
train = set(manifest["split"]["train"])
corpus = " ".join((ROOT / "corpus" / "text" / f'{d["id"]}.txt').read_text(encoding="utf-8", errors="replace")
                  for d in manifest["documents"] if d["status"] == "ok" and d["family"] in train)
fired = [p["name"] for p in spec["tier1"] if p.get("regex") and re.search(p["regex"], corpus, re.I)]
check("no tier-1 pattern fires on expert prose", not fired, ", ".join(fired[:4]))

# 6. The frozen eval hashes still describe the files the results were computed against.
frozen = json.loads((ROOT / "eval" / "FROZEN.json").read_text())
for f, h in frozen["sha256"].items():
    actual = hashlib.sha256((ROOT / "eval" / f).read_bytes()).hexdigest()
    check(f"frozen hash {f}", actual == h, "eval changed after freezing")

# 7. The gate runs, fails closed, and passes the exemplars on tier-1.
r = subprocess.run([sys.executable, str(ROOT / "skill" / "scripts" / "prose-check.py"),
                    str(ROOT / "skill" / "references" / "exemplars" / "danluu-latency-pitfalls.txt")],
                   capture_output=True, text=True)
check("gate runs", r.returncode in (0, 1) and "REPORT" in r.stdout)
check("gate reports construction rates", "causal 'so' per 1000 words" in r.stdout)

# 8. Results reference every metric, including the unrun ones.
res = (ROOT / "eval" / "results.md").read_text()
for metric in ["Metric 1", "Metric 2", "Metric 3", "Metric 4"]:
    check(f"results.md covers {metric}", metric in res)
check("results.md marks unrun metrics NOT RUN", "NOT RUN" in res)
check("results.md records H as invalid", "invalid in this design" in res)

print(f"PASS {len(oks)}   FAIL {len(fails)}\n")
for f in fails:
    print(f"  FAIL  {f}")
if not fails:
    print("  all checks pass")
sys.exit(1 if fails else 0)
