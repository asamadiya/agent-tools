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

PATTERNS = {
    "causal so (R2)": r"(?:^|[,;]\s+)so\b(?!\s+(?:that|far|long|much|many|called))",
    "all so": r"\bso\b",
    "instead of (R3)": r"\binstead of\b",
    "rather than (R3)": r"\brather than\b",
    "em dash (R11)": r"—",
    "hedges": r"\b(?:roughly|somewhat|arguably|essentially|effectively|typically|generally|likely|perhaps|possibly)\b",
}


def rate(texts: list[str], pattern: str) -> float:
    blob = " ".join(texts).lower()
    words = len(re.findall(r"[a-z][a-z'’\-]*", blob))
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
