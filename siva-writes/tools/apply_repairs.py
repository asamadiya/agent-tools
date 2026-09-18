#!/usr/bin/env python3
"""Apply the repair passes to the frozen eval, and refuse to apply anything ambiguous.

Repairs arrive as {target, after} from several agents across several passes. A target names a brief
prompt, a facts entry, or a question. Three rules here exist because each failure is silent:

Unresolvable targets are reported, never skipped. An agent that names `design_doc-2-q3` when the id
is `design_doc-02-q3` produces a repair that does nothing, and a run that quietly drops it reports
"21 repairs applied" while shipping the defect.

Later passes win. The recovery pass was told to fix what the verify pass called broken, so its
output must overwrite the first pass's for the same target. Applying them in file order would let
the broken version win whenever the filesystem happened to sort it last.

Every question's accept list is re-checked for the collapse the verify pass caught: a key whose
numeric content is a single small integer will score any reply containing that digit.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EVAL = ROOT / "eval"


def parse_target(target: str):
    """-> (brief_id, kind, key) where kind is prompt | facts | question"""
    t = target.strip()
    m = re.match(r"^([a-z_]+-\d+)\s*\(brief prompt\)", t)
    if m:
        return m.group(1), "prompt", None
    m = re.match(r"^([a-z_]+-\d+)\s*facts\[(.+?)\]", t)
    if m:
        return m.group(1), "facts", m.group(2)
    m = re.match(r"^([a-z_]+-\d+)-q(\d+)$", t)
    if m:
        return m.group(1), "question", int(m.group(2))
    m = re.match(r"^([a-z_]+-\d+)$", t)
    if m:
        return m.group(1), "prompt", None
    return None, None, None


def coerce(after):
    """Repairs carry 'after' either as a JSON-encoded object or as a plain string."""
    if isinstance(after, dict):
        return after
    s = str(after).strip()
    if s.startswith("{"):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return s
    return s


def numeric_key_collapsed(q: dict) -> bool:
    """The failure mode the verify pass found: a key whose numbers reduce to one small integer."""
    nums = set()
    for s in [q.get("answer", ""), *q.get("accept", [])]:
        nums |= {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", s)}
    return len(nums) == 1 and next(iter(nums)) in {"0", "1", "2", "3"}


def main() -> None:
    briefs = {}
    order = []
    for line in (EVAL / "prompts.jsonl").read_text().splitlines():
        b = json.loads(line)
        briefs[b["id"]] = b
        order.append(b["id"])
    questions = {}
    for line in (EVAL / "questions.jsonl").read_text().splitlines():
        q = json.loads(line)
        questions[q["id"]] = q

    # Ordering is explicit: the first repair pass, then the recovery pass that was told to fix it.
    passes = sorted((EVAL / "repairs").glob("*.json"), key=lambda p: (p.name.endswith(".fix.json"), p.name))
    repairs, provenance = [], {}
    for path in passes:
        blob = json.loads(path.read_text())
        items = blob.get("repairs", [])
        for r in items:
            repairs.append(r)
            provenance[r["target"]] = path.name

    applied, unresolved, changed_questions = 0, [], []
    for r in repairs:
        bid, kind, key = parse_target(r["target"])
        if bid is None or bid not in briefs:
            unresolved.append({"target": r["target"], "why": "brief id does not resolve", "from": provenance.get(r["target"])})
            continue
        after = coerce(r.get("after"))
        if kind == "prompt":
            if not isinstance(after, str) or len(after) < 60:
                unresolved.append({"target": r["target"], "why": "prompt replacement missing or too short", "from": provenance.get(r["target"])})
                continue
            briefs[bid]["prompt"] = after
            applied += 1
        elif kind == "facts":
            facts = briefs[bid].get("facts", [])
            hit = next((f for f in facts if f.get("key") == key), None)
            if hit is None:
                unresolved.append({"target": r["target"], "why": f"facts key {key!r} not present", "from": provenance.get(r["target"])})
                continue
            hit["value"] = after if isinstance(after, str) else json.dumps(after)
            applied += 1
        elif kind == "question":
            qid = f"{bid}-q{key}"
            if qid not in questions:
                unresolved.append({"target": r["target"], "why": "question id does not resolve", "from": provenance.get(r["target"])})
                continue
            if not isinstance(after, dict) or "q" not in after:
                unresolved.append({"target": r["target"], "why": "question replacement is not an object with q/answer/accept", "from": provenance.get(r["target"])})
                continue
            questions[qid].update({"q": after["q"], "answer": after.get("answer", questions[qid]["answer"]),
                                   "accept": after.get("accept", questions[qid].get("accept", []))})
            changed_questions.append(qid)
            applied += 1

    # Dropped questions: a recovery pass may remove an item it judges ungradeable.
    dropped = set()
    for path in passes:
        for u in json.loads(path.read_text()).get("unrepaired", []):
            if "drop" in str(u.get("why", "")).lower() or "remove" in str(u.get("why", "")).lower():
                bid, kind, key = parse_target(u["target"])
                if kind == "question" and f"{bid}-q{key}" in questions:
                    dropped.add(f"{bid}-q{key}")
    for qid in dropped:
        questions.pop(qid, None)

    collapsed = [qid for qid, q in questions.items() if numeric_key_collapsed(q)]

    (EVAL / "prompts.jsonl").write_text("".join(json.dumps(briefs[i]) + "\n" for i in order))
    (EVAL / "questions.jsonl").write_text("".join(
        json.dumps(q) + "\n" for _, q in sorted(questions.items(),
                                                key=lambda kv: (kv[1]["brief_id"], int(kv[0].rsplit("q", 1)[1])))))

    report = {"repairs_seen": len(repairs), "applied": applied, "unresolved": unresolved,
              "questions_changed": len(set(changed_questions)), "questions_dropped": sorted(dropped),
              "questions_remaining": len(questions),
              "numeric_key_collapsed": collapsed,
              "passes_in_order": [p.name for p in passes]}
    (ROOT / "reports" / "eval-repairs-applied.json").write_text(json.dumps(report, indent=2))

    print(f'repairs seen      {len(repairs)}')
    print(f'applied           {applied}')
    print(f'unresolved        {len(unresolved)}')
    for u in unresolved[:12]:
        print(f'   {u["target"]:38s} {u["why"]}  [{u["from"]}]')
    print(f'questions changed {len(set(changed_questions))}')
    print(f'questions dropped {len(dropped)}  {sorted(dropped)}')
    print(f'questions left    {len(questions)}')
    if collapsed:
        print(f'\nWARNING numeric key collapsed to a single small integer ({len(collapsed)}):')
        for qid in collapsed[:10]:
            print(f'   {qid:22s} {questions[qid]["answer"][:60]}')


if __name__ == "__main__":
    main()
