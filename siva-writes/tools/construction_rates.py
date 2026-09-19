#!/usr/bin/env python3
"""Measure the constructions the owner rules license, across every condition and round.

Added after Metric 4's stylometric trigrams put "so a <w>" at the top of condition D. The rules
that name a construction - R2 for causal "so", R3 for "instead of" against "rather than" - can be
checked against how often that construction actually appears, which is a different question from
whether any single sentence obeys the rule.
"""
from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


# Causal "so" has to be counted PER SENTENCE. Applied to a joined document, "^" matches once at the
# very start and never again, so every sentence-initial "So ..." after the first is missed - the
# defect that produced a monotonic trend which does not survive correction.
#
# "so" is also excluded when it is a degree modifier ("so deep that it broke the profiler") or
# purposive ("so that"). The degree use is the one that slipped through: the old negative lookahead
# only fired when "that" came immediately after "so".
SENT = re.compile(r"(?<=[.!?])\s+")
CAUSAL_SO_SENT = re.compile(
    r"(?:^|[,;]\s+)so\b"
    r"(?!\s+(?:that|far|long|much|many|called))"          # purposive and fixed phrases
    r"(?!\s+\w+(?:ly)?\s+that\b)"                         # degree: so deep that, so quickly that
    r"(?!\s+(?:deep|fast|slow|big|small|large|many|few|hot|cold|late|early|high|low)\b)",
    re.I)


def causal_so_count(text: str) -> int:
    return sum(len(CAUSAL_SO_SENT.findall(s.strip())) for s in SENT.split(text) if s.strip())

PATTERNS = {
    "causal so (R2)": "CAUSAL_SO",
    "all so": r"\bso\b",
    "instead of (R3)": r"\binstead of\b",
    "rather than (R3)": r"\brather than\b",
    "em dash (R11)": r"—",
    "hedges": r"\b(?:roughly|somewhat|arguably|essentially|effectively|typically|generally|likely|perhaps|possibly)\b",
}


def rate(texts: list[str], pattern: str) -> float:
    blob = " ".join(texts)
    words = len(re.findall(r"[a-z][a-z'’\-]*", blob.lower()))
    if pattern == "CAUSAL_SO":
        return 1000 * causal_so_count(blob) / max(1, words)
    return 1000 * len(re.findall(pattern, blob, re.I)) / max(1, words)


def read_dir(path: pathlib.Path) -> list[str]:
    return [p.read_text(encoding="utf-8", errors="replace") for p in sorted(path.glob("*.txt"))]


def main() -> None:
    manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
    train = set(manifest["split"]["train"])
    corpus = [(ROOT / "corpus" / "text" / f'{d["id"]}.txt').read_text(encoding="utf-8", errors="replace")
              for d in manifest["documents"] if d["status"] == "ok" and d["family"] in train]

    sources: list[tuple[str, list[str]]] = [("TRAIN", corpus)]
    for c in "ABCDH":
        p = ROOT / "eval" / "outputs" / c
        if p.exists():
            sources.append((f"r1 {c}", read_dir(p)))
    for c in "BCD":
        p = ROOT / "eval" / "outputs-r2" / c
        if p.exists() and any(p.glob("*.txt")):
            sources.append((f"r2 {c}", read_dir(p)))

    columns = [name for name, _ in sources]
    rows = {label: [rate(texts, pat) for _, texts in sources] for label, pat in PATTERNS.items()}
    (ROOT / "eval" / "results-construction-rates.json").write_text(json.dumps(
        {"unit": "occurrences per 1000 words", "columns": columns, "rows": rows,
         "note": "TRAIN is the reference corpus of expert human writing. r1 H is held-out human "
                 "writing. The rest are model conditions."}, indent=2))

    width = max(len(c) for c in columns) + 2
    print("per 1000 words\n")
    print(f'{"construction":18s}' + "".join(f"{c:>{width}s}" for c in columns))
    for label, vals in rows.items():
        print(f'{label:18s}' + "".join(f"{v:>{width}.2f}" for v in vals))


if __name__ == "__main__":
    main()
