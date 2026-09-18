#!/usr/bin/env python3
"""Assemble the frozen eval from the build workflow's journal, and gate it.

Two gates run here rather than later, because both failures are silent.

Anchor resolution. A brief claims condition H exists by naming the first and last twelve words
of a span in a source document. If those words cannot be found verbatim, H for that brief does
not exist - and the eval would simply report fewer H comparisons without ever saying why. Every
anchor is resolved against the actual file, and any brief whose span does not resolve is demoted
to has_human=false with the reason recorded.

Question independence. A comprehension question answerable from its own wording measures nothing.
The cheap mechanical version of that check - does the expected answer appear inside the question
text - runs here. It does not catch everything, and the critic pass covers the rest.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT = ROOT / "corpus" / "text"
EVAL = ROOT / "eval"
JOURNAL = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None


def normalise(s: str) -> str:
    """Whitespace and smart-quote differences must not break an otherwise-correct anchor."""
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.replace("—", "--").replace("–", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def read_journal(path: pathlib.Path) -> tuple[list[dict], list[dict], list[str]]:
    briefs, questions, strings = [], [], []
    for line in path.read_text().splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "result":
            continue
        result = entry.get("result")
        if isinstance(result, dict) and "briefs" in result:
            briefs.extend(result["briefs"])
        elif isinstance(result, dict) and "items" in result:
            questions.extend(result["items"])
        elif isinstance(result, str):
            strings.append(result)
    return briefs, questions, strings


def resolve_anchor(brief: dict) -> dict:
    """Locate the human span, or demote the brief and say why."""
    if not brief.get("has_human"):
        return {**brief, "human_span": None, "human_words": 0}
    doc = brief.get("source_doc", "")
    path = TEXT / f"{doc}.txt"
    if not path.exists():
        return {**brief, "has_human": False, "demoted": f"source_doc {doc!r} not in corpus", "human_span": None, "human_words": 0}
    raw = path.read_text(encoding="utf-8", errors="replace")
    flat = normalise(raw)
    first, last = normalise(brief.get("human_first_words", "")), normalise(brief.get("human_last_words", ""))
    if not first or not last:
        return {**brief, "has_human": False, "demoted": "anchor words empty", "human_span": None, "human_words": 0}
    i = flat.find(first)
    if i < 0:
        return {**brief, "has_human": False, "demoted": "first anchor not found verbatim", "human_span": None, "human_words": 0}
    j = flat.find(last, i)
    if j < 0:
        return {**brief, "has_human": False, "demoted": "last anchor not found after first", "human_span": None, "human_words": 0}
    # Map the normalised offsets back onto the raw text by walking words, so the stored span keeps
    # the document's real punctuation and casing rather than the lowercased search copy.
    start_word = len(flat[:i].split())
    end_word = len(flat[: j + len(last)].split())
    words = raw.split()
    span = " ".join(words[start_word:end_word])
    if len(span.split()) < 120:
        return {**brief, "has_human": False, "demoted": f"span only {len(span.split())} words, too short to compare", "human_span": None, "human_words": 0}
    return {**brief, "human_span": span, "human_words": len(span.split())}


def main() -> None:
    if JOURNAL is None or not JOURNAL.exists():
        raise SystemExit("usage: assemble_eval.py <journal.jsonl>")
    EVAL.mkdir(exist_ok=True)
    briefs, question_items, strings = read_journal(JOURNAL)

    judge = next((s for s in strings if "VERDICT" in s), "")
    critic = next((s for s in strings if s is not judge), "")

    resolved = [resolve_anchor(b) for b in briefs]
    by_id = {b["id"]: b for b in resolved}
    if len(by_id) != len(resolved):
        print(f"WARNING: {len(resolved) - len(by_id)} duplicate brief ids collapsed", file=sys.stderr)

    # Question independence: the answer must not be readable off the question.
    leaky = []
    kept_questions = []
    for item in question_items:
        bid = item["brief_id"]
        if bid not in by_id:
            print(f"WARNING: questions for unknown brief {bid}", file=sys.stderr)
            continue
        for n, q in enumerate(item["questions"], 1):
            answer = normalise(q["answer"])
            question = normalise(q["q"])
            # A question and its answer necessarily share the subject: "what swap limits do
            # containers A and B end up with" has "container" in both, and an overlap-ratio test
            # flags it as a leak. The property that actually matters is whether the answer adds
            # anything the question did not already contain. Leak iff it adds nothing.
            tokens = set(re.findall(r"\d[\d.,]*|[a-z]{4,}", answer))
            novel = [t for t in tokens if t not in question]
            if tokens and not novel:
                leaky.append({"brief_id": bid, "n": n, "q": q["q"], "answer": q["answer"]})
            kept_questions.append({"id": f"{bid}-q{n}", "brief_id": bid, **q})

    prompts_path = EVAL / "prompts.jsonl"
    questions_path = EVAL / "questions.jsonl"
    prompts_path.write_text("".join(json.dumps(b) + "\n" for b in sorted(resolved, key=lambda b: b["id"])))
    questions_path.write_text("".join(json.dumps(q) + "\n" for q in kept_questions))
    (EVAL / "judge-prompt.md").write_text(judge)
    (ROOT / "reports" / "eval-critic.md").write_text(critic)

    with_human = [b for b in resolved if b.get("has_human")]
    demoted = [b for b in resolved if b.get("demoted")]
    genres = sorted({b["id"].rsplit("-", 1)[0] for b in resolved})

    frozen = {
        "frozen_note": "Built before any Phase 3 skill tuning, by agents that never read the skill. "
                       "Any change to these files after this point invalidates comparison with prior rounds.",
        "n_briefs": len(resolved),
        "n_questions": len(kept_questions),
        "genres": {g: sum(1 for b in resolved if b["id"].startswith(g)) for g in genres},
        "n_with_human": len(with_human),
        "human_by_genre": {g: sum(1 for b in with_human if b["id"].startswith(g)) for g in genres},
        "demoted_from_human": [{"id": b["id"], "reason": b["demoted"]} for b in demoted],
        "questions_flagged_leaky": leaky,
        "sha256": {
            "prompts.jsonl": hashlib.sha256(prompts_path.read_bytes()).hexdigest(),
            "questions.jsonl": hashlib.sha256(questions_path.read_bytes()).hexdigest(),
            "judge-prompt.md": hashlib.sha256((EVAL / "judge-prompt.md").read_bytes()).hexdigest(),
        },
    }
    (EVAL / "FROZEN.json").write_text(json.dumps(frozen, indent=2))

    print(f'briefs            {frozen["n_briefs"]}  {frozen["genres"]}')
    print(f'questions         {frozen["n_questions"]}')
    print(f'with human (H)    {frozen["n_with_human"]}  {frozen["human_by_genre"]}')
    print(f'demoted from H    {len(demoted)}')
    for d in demoted:
        print(f'   {d["id"]:22s} {d["demoted"]}')
    print(f'leaky questions   {len(leaky)}')
    for l in leaky[:10]:
        print(f'   {l["brief_id"]}-q{l["n"]}  leaked={l["leaked"]}  {l["q"][:78]}')
    print(f'judge prompt      {len(judge)} chars')
    print(f'critic report     {len(critic)} chars')


if __name__ == "__main__":
    main()
