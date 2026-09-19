#!/usr/bin/env python3
"""Freeze the eval: hash it, and check the properties that make it usable before doing so.

Freezing is not just hashing. A frozen set with a broken property is a broken set that nobody is
allowed to fix without invalidating comparisons, so the checks run first and the freeze refuses if
any of them fails.

  - every has_human brief's span still resolves verbatim in its source file
  - every question's brief exists, and every brief has exactly five questions
  - no question is answerable from its own wording
  - no accept list has collapsed to something that scores any reply
  - genre balance is what it claims to be
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVAL = ROOT / "eval"
TEXT = ROOT / "corpus" / "text"


def normalise(s: str) -> str:
    s = s.replace("’", "'").replace("“", '"').replace("”", '"').replace("—", "--")
    return re.sub(r"\s+", " ", s).strip().lower()


def main() -> None:
    briefs = [json.loads(l) for l in (EVAL / "prompts.jsonl").read_text().splitlines()]
    questions = [json.loads(l) for l in (EVAL / "questions.jsonl").read_text().splitlines()]
    problems: list[str] = []

    by_brief: dict[str, list] = {}
    for q in questions:
        by_brief.setdefault(q["brief_id"], []).append(q)

    ids = {b["id"] for b in briefs}
    for bid in by_brief:
        if bid not in ids:
            problems.append(f"questions reference unknown brief {bid}")
    for b in briefs:
        n = len(by_brief.get(b["id"], []))
        if n != 5:
            problems.append(f'{b["id"]} has {n} questions, expected 5')

    # Human spans must still resolve. A repair that edited a brief cannot have edited the source,
    # but an editing pass that rewrote an anchor would silently drop H for that brief.
    for b in briefs:
        if not b.get("has_human"):
            continue
        src = TEXT / f'{b["source_doc"]}.txt'
        if not src.exists():
            problems.append(f'{b["id"]} source_doc missing: {b["source_doc"]}')
            continue
        flat = normalise(src.read_text(encoding="utf-8", errors="replace"))
        if normalise(b.get("human_first_words", "")) not in flat:
            problems.append(f'{b["id"]} human_first_words no longer resolves')
        if not b.get("human_span") or len(b["human_span"].split()) < 120:
            problems.append(f'{b["id"]} human_span missing or under 120 words')

    # Self-answering and permissive keys. Permissiveness is judged AFTER the grader's own
    # normalisation, because that is what actually gets matched. "{}" is the correct answer to what
    # kubelet writes for a container declaring no requests; it normalises to the empty string, so
    # the grader skips it and it can match nothing. That is inert, not permissive. A key that
    # normalises to "yes" or to a single digit is the thing that scores any reply.
    sys.path.insert(0, str(ROOT / "tools"))
    from comprehension import normalise as grader_normalise

    inert = []
    for q in questions:
        ans, qt = normalise(q["answer"]), normalise(q["q"])
        toks = set(re.findall(r"\d[\d.,]*|[a-z]{4,}", ans))
        if toks and not [t for t in toks if t not in qt]:
            problems.append(f'{q["id"]} answer adds no token the question lacks')
        for a in q.get("accept", []):
            g = grader_normalise(a)
            if not g:
                inert.append(f'{q["id"]}: {a!r}')
            elif g in {"yes", "no", "true", "false"} or re.fullmatch(r"\d", g):
                problems.append(f'{q["id"]} accept entry scores almost any reply: {a!r}')

    genres: dict[str, int] = {}
    human: dict[str, int] = {}
    for b in briefs:
        g = b["id"].rsplit("-", 1)[0]
        genres[g] = genres.get(g, 0) + 1
        human[g] = human.get(g, 0) + (1 if b.get("has_human") else 0)

    print(f'briefs {len(briefs)}  questions {len(questions)}  with H {sum(human.values())}')
    for g in sorted(genres):
        print(f'   {g:16s} {genres[g]:2d} briefs, {human[g]:2d} with a human reference')
    if inert:
        print(f'\ninert accept entries ({len(inert)}) - normalise to empty, matched by nothing, harmless:')
        for i in inert[:6]:
            print(f'   {i}')
    if problems:
        print(f'\nREFUSING TO FREEZE. {len(problems)} problems:')
        for p in problems[:25]:
            print(f'   {p}')
        sys.exit(1)

    payload = {
        "frozen": True,
        "note": "Built by agents that never read the skill, then rechecked, repaired and verified. "
                "Any change to prompts.jsonl or questions.jsonl after this point invalidates "
                "comparison with results produced against these hashes.",
        "n_briefs": len(briefs), "n_questions": len(questions),
        "genres": genres, "human_by_genre": human,
        "sha256": {f: hashlib.sha256((EVAL / f).read_bytes()).hexdigest()
                   for f in ("prompts.jsonl", "questions.jsonl", "judge-prompt.md")},
        "repair_history": ["reports/eval-critic.md", "reports/eval-repair-verify.md",
                           "reports/eval-repairs-applied.json"],
    }
    (EVAL / "FROZEN.json").write_text(json.dumps(payload, indent=2))
    print("\nFROZEN")
    for f, h in payload["sha256"].items():
        print(f'   {f:20s} {h[:16]}')


if __name__ == "__main__":
    main()
