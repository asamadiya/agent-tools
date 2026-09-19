#!/usr/bin/env python3
"""Metric 2: comprehension. A weaker model from a different family reads only the candidate
write-up and answers five factual questions per brief.

The reader is gemini-3.5-flash, driven through the copilot CLI. Two properties are required and
both are structural rather than stylistic.

Different family. The writer is Claude. A Claude judge prefers Claude prose, and the same is true
across families; using a non-Claude reader removes that particular thumb from the scale.

Weaker. A strong reader reconstructs the answer from domain knowledge and scores well on prose that
never transmitted it, which collapses the difference between conditions. The metric needs a reader
that will only get the answer if the writing actually handed it over.

The reader is given the write-up and the questions, and never the brief. Grading is deterministic
first - normalised match against the answer and its accept list - and every non-match is written to
a file for adjudication rather than silently scored zero, because a deterministic grader marking a
correct paraphrase wrong is the failure mode that makes this metric look noisier than it is.
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
READER_MODEL = "gemini-3.5-flash"


def normalise(s: str) -> str:
    s = s.lower().replace("’", "'").replace("—", "-").replace("–", "-")
    s = re.sub(r"[^\w\s.%/-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


UNIT = re.compile(r"\b(?:[kmgtp]i?b|bytes?|ms|us|ns|s|sec|secs|seconds?|minutes?|hours?|days?|"
                  r"%|percent|rps|qps|tps|flops?|hz|[kmg]hz|cores?|nodes?|pods?|replicas?)\b", re.I)


def numbers_in(s: str) -> list[str]:
    """Ordered, because a set match scores a reply that reverses two allocations."""
    return [n.rstrip(".").replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", s)]


def numbers_ordered_in(key: list[str], reply: list[str]) -> bool:
    """Every key number present, in the key's order."""
    i = 0
    for r in reply:
        if i < len(key) and r == key[i]:
            i += 1
    return i == len(key)


def graded_correct(reply: str, answer: str, accept: list[str]) -> tuple[bool | None, str]:
    """Returns True, False, or None for "a human or a different-family model has to look".

    No purely lexical grader is both precise and complete. "Little's law ties it to concurrency of
    busy threads" is a correct answer to a key phrased "the same fraction of busy threads is
    occupied", and it shares half the content words. Lowering the threshold until that case passes
    is fitting the instrument to one hand-written example, and it admits replies that share words
    with the key while saying something else.

    So the middle band is not scored. It is routed to adjudication, and the count of adjudicated
    items is reported beside the accuracy, because a metric that silently marks correct paraphrases
    wrong reads as noise in the conditions that paraphrase most.
    """
    r = normalise(reply)
    best = 0.0
    for candidate in [answer, *accept]:
        c = normalise(candidate)
        if not c:
            continue
        if c in r:
            return True, f"substring:{candidate[:40]}"
        cn = numbers_in(c)
        numbers_present = bool(cn) and numbers_ordered_in(cn, numbers_in(r))
        # A unit named in the key has to appear in the reply: 19 GB and 19 GiB are different
        # answers, and a set-of-digits match cannot tell them apart.
        key_units = {u.lower() for u in UNIT.findall(c)}
        if key_units and not (key_units & {u.lower() for u in UNIT.findall(r)}):
            numbers_present = False
        distinctive = any(len(n) > 1 or "." in n for n in cn)
        words = [w for w in c.split() if len(w) > 3]
        lexical = sum(1 for w in words if w in r) / len(words) if words else 0.0
        best = max(best, lexical)
        if numbers_present and distinctive:
            return True, f"numeric:{sorted(cn)}"
        if numbers_present and lexical >= 0.5:
            return True, f"numeric+lexical:{sorted(cn)} {lexical:.2f}"
        # Word overlap must not override a numeric disagreement. "A gets 9.5 GB and B gets 19 GB"
        # shares 90% of its content words with the key that says the opposite, and the lexical path
        # scored it correct until this guard existed. If the key carries numbers, they decide.
        if lexical >= 0.8 and (not cn or numbers_present):
            return True, f"lexical:{candidate[:40]}"
    if 0.4 <= best < 0.8:
        return None, f"adjudicate:lexical {best:.2f}"
    return False, f"no match:lexical {best:.2f}"


def adjudicate(question: str, expected: str, accept: list[str], reply: str) -> bool:
    """Semantic equivalence, judged by a different family from the writer."""
    prompt = (
        "Does the REPLY convey the same fact as the EXPECTED answer? Wording may differ entirely; "
        "what matters is whether the same quantity, mechanism, or decision is stated. Answer with "
        "exactly one word: YES or NO.\n\n"
        f"QUESTION: {question}\nEXPECTED: {expected}\n"
        f"ALSO ACCEPTABLE: {'; '.join(accept[:6])}\nREPLY: {reply}\n")
    try:
        proc = subprocess.run(
            ["copilot", "--model", READER_MODEL, "--reasoning-effort", "low",
             "--session-id", str(uuid.uuid4()), "--allow-all-tools", "--silent", "-p", prompt],
            capture_output=True, text=True, timeout=300)
        return "YES" in (proc.stdout or "").upper()[:200]
    except subprocess.TimeoutExpired:
        return False


def ask_reader(write_up: str, questions: list[dict]) -> list[str]:
    numbered = "\n".join(f"{i}. {q['q']}" for i, q in enumerate(questions, 1))
    prompt = (
        "Below is a technical document. Read it and answer the questions using ONLY what the "
        "document says. If the document does not contain the answer, reply exactly: NOT STATED.\n"
        "Answer each question on its own line, prefixed with its number and nothing else. Be brief.\n\n"
        f"=== DOCUMENT ===\n{write_up}\n=== END DOCUMENT ===\n\n=== QUESTIONS ===\n{numbered}\n"
    )
    proc = subprocess.run(
        ["copilot", "--model", READER_MODEL, "--reasoning-effort", "low",
         "--session-id", str(uuid.uuid4()), "--allow-all-tools", "--silent", "-p", prompt],
        capture_output=True, text=True, timeout=420,
    )
    out = proc.stdout or ""
    answers = [""] * len(questions)
    for line in out.splitlines():
        m = re.match(r"\s*(\d{1,2})[.)]\s*(.+)", line)
        if m:
            idx = int(m.group(1)) - 1
            if 0 <= idx < len(answers):
                answers[idx] = m.group(2).strip()
    return answers


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", default=str(ROOT / "eval" / "outputs"))
    parser.add_argument("--out", default=str(ROOT / "eval" / "results-metric2.json"))
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--conditions", nargs="*", default=None)
    args = parser.parse_args()

    questions = collections.defaultdict(list)
    for line in (ROOT / "eval" / "questions.jsonl").read_text().splitlines():
        q = json.loads(line)
        questions[q["brief_id"]].append(q)

    root = pathlib.Path(args.outputs)
    conditions = args.conditions or sorted(p.name for p in root.iterdir() if p.is_dir())

    jobs = []
    for condition in conditions:
        for path in sorted((root / condition).glob("*.txt")):
            bid = path.stem
            if bid in questions:
                jobs.append((condition, bid, path))

    results, unmatched = [], []

    def run(job):
        condition, bid, path = job
        qs = questions[bid]
        try:
            replies = ask_reader(path.read_text(encoding="utf-8", errors="replace"), qs)
        except subprocess.TimeoutExpired:
            return {"condition": condition, "brief_id": bid, "error": "reader timeout", "correct": 0, "n": len(qs)}
        row = {"condition": condition, "brief_id": bid, "n": len(qs), "correct": 0,
               "adjudicated": 0, "items": []}
        for q, reply in zip(qs, replies):
            ok, how = graded_correct(reply, q["answer"], q.get("accept", []))
            if ok is None:
                ok = adjudicate(q["q"], q["answer"], q.get("accept", []), reply)
                how = f"{how} -> {'YES' if ok else 'NO'}"
                row["adjudicated"] += 1
            row["correct"] += bool(ok)
            row["items"].append({"id": q["id"], "reply": reply, "correct": bool(ok), "how": how})
            if not ok:
                unmatched.append({"condition": condition, "id": q["id"], "q": q["q"],
                                  "expected": q["answer"], "accept": q.get("accept", []),
                                  "reply": reply, "how": how})
        return row

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, row in enumerate(pool.map(run, jobs), 1):
            results.append(row)
            print(f'[{i}/{len(jobs)}] {row["condition"]:10s} {row["brief_id"]:20s} '
                  f'{row["correct"]}/{row["n"]}{"  " + row["error"] if row.get("error") else ""}',
                  file=sys.stderr, flush=True)

    by_condition = {}
    for condition in conditions:
        rows = [r for r in results if r["condition"] == condition]
        correct = sum(r["correct"] for r in rows)
        total = sum(r["n"] for r in rows)
        # Wilson 95% interval, the same instrument the pairwise metric uses.
        if total:
            p, z = correct / total, 1.959963985
            d = 1 + z * z / total
            centre = (p + z * z / (2 * total)) / d
            half = z * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5) / d
            ci = [round(100 * (centre - half), 2), round(100 * (centre + half), 2)]
        else:
            ci = [0.0, 0.0]
        by_condition[condition] = {
            "documents": len(rows), "items": total, "correct": correct,
            "accuracy_pct": round(100 * correct / total, 2) if total else 0.0,
            "wilson95_pct": ci,
            "adjudicated": sum(r.get("adjudicated", 0) for r in rows),
            "reader_errors": sum(1 for r in rows if r.get("error")),
        }

    (pathlib.Path(args.out)).write_text(json.dumps({
        "reader_model": READER_MODEL,
        "reader_sees": "candidate write-up and questions only, never the brief",
        "grading": "deterministic normalised match; non-matches recorded in results-metric2-unmatched.json for adjudication",
        "by_condition": by_condition, "rows": results}, indent=2))
    (ROOT / "eval" / "results-metric2-unmatched.json").write_text(json.dumps(unmatched, indent=2))

    print(f'\n{"condition":12s}{"docs":>6s}{"items":>7s}{"correct":>9s}{"acc%":>8s}{"wilson95":>18s}')
    for c, r in by_condition.items():
        print(f'{c:12s}{r["documents"]:6d}{r["items"]:7d}{r["correct"]:9d}{r["accuracy_pct"]:8.2f}'
              f'   [{r["wilson95_pct"][0]:.1f}, {r["wilson95_pct"][1]:.1f}]')
    print(f'\nunmatched for adjudication: {len(unmatched)} -> eval/results-metric2-unmatched.json')


if __name__ == "__main__":
    main()
