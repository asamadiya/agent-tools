#!/usr/bin/env python3
"""Merge the four negative-set extractions and tier them by measured false-positive behaviour.

The merge agent was asked to adversarially test each regex against the other agents' negative
examples and died mid-response. That test is better done here anyway: compiling a pattern and
running it over a list of sentences is a fact, not a judgement, and an agent asked to do it
reports its conclusion rather than the run.

Tiering is therefore derived, not chosen:

  tier1  compiles, fires on its own positives, and fires on ZERO negative examples from ANY of the
         four lists. These fail a document.
  tier2  compiles and over-fires on at least one negative example, or its author marked it medium
         or low confidence. These flag for a human read.
  tier3  no usable regex. Prose guidance only.

The cross-list test is the part that earns its keep. A pattern survives its own author's negatives
by construction, because the same agent wrote both. Another agent's negatives are the first
genuinely adversarial input it meets.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load(journal: pathlib.Path) -> list[dict]:
    out = []
    for line in journal.read_text().splitlines():
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        result = entry.get("result")
        if entry.get("type") == "result" and isinstance(result, dict) and "patterns" in result:
            out.append(result)
    return out


def main() -> None:
    journal = pathlib.Path(sys.argv[1])
    extractions = load(journal)
    patterns, by_name = [], {}
    for ex in extractions:
        for p in ex["patterns"]:
            name = p["name"]
            if name in by_name:
                by_name[name]["n_sources"] += 1
                by_name[name]["positive_examples"] += p.get("positive_examples", [])
                by_name[name]["negative_examples"] += p.get("negative_examples", [])
                continue
            p = {**p, "n_sources": 1}
            by_name[name] = p
            patterns.append(p)

    # Every negative example from every list becomes an adversarial corpus for every pattern.
    all_negatives = [(p["name"], s) for p in patterns for s in p.get("negative_examples", [])]

    # The stronger test. Hand-written negative examples are short, invented, and written by the
    # same kind of agent that wrote the pattern; 184,000 words of published expert engineering
    # prose is the population the linter will actually run on. A pattern that fires there cannot
    # be a hard failure, whatever its author believed. Measured: this demotes 5 of 30 that the
    # negative-example test alone passed, including one firing 215 times across 15 documents.
    manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
    train_families = set(manifest["split"]["train"])
    corpus = [
        (d["id"], (ROOT / "corpus" / "text" / f'{d["id"]}.txt').read_text(encoding="utf-8", errors="replace"))
        for d in manifest["documents"] if d["status"] == "ok" and d["family"] in train_families
    ]
    corpus_words = sum(len(t.split()) for _, t in corpus)
    print(f'{len(patterns)} distinct patterns, {len(all_negatives)} negative examples pooled')
    print(f'expert-prose control: {len(corpus)} documents, {corpus_words:,} words\n')

    tier1, tier2, tier3, broken = [], [], [], []
    for p in patterns:
        rx_src = (p.get("regex") or "").strip()
        if not rx_src:
            tier3.append(p)
            continue
        try:
            rx = re.compile(rx_src, re.I)
        except re.error as exc:
            p["compile_error"] = str(exc)
            broken.append(p)
            continue
        own_pos = [s for s in p.get("positive_examples", []) if rx.search(s)]
        p["fires_on_own_positives"] = f'{len(own_pos)}/{len(p.get("positive_examples", []))}'
        over = [(owner, s) for owner, s in all_negatives if rx.search(s)]
        p["over_fires_on"] = [{"from_pattern": o, "sentence": s} for o, s in over[:6]]
        p["n_over_fires"] = len(over)
        corpus_hits = [(did, m.group()[:70]) for did, text in corpus for m in rx.finditer(text)]
        p["expert_prose_hits"] = len(corpus_hits)
        p["expert_prose_documents"] = len({d for d, _ in corpus_hits})
        p["expert_prose_examples"] = [{"doc": d, "match": s} for d, s in corpus_hits[:4]]
        if not own_pos:
            p["demoted"] = "does not fire on its own positive examples"
            tier2.append(p)
        elif corpus_hits:
            p["demoted"] = (f'fires {len(corpus_hits)} times across {p["expert_prose_documents"]} '
                            f'documents of expert human prose')
            tier2.append(p)
        elif over:
            p["demoted"] = f"fires on {len(over)} negative example(s) from the pooled adversarial set"
            tier2.append(p)
        elif p.get("confidence") != "high":
            p["demoted"] = f'author confidence {p.get("confidence")}'
            tier2.append(p)
        else:
            tier1.append(p)

    payload = {
        "method": "four independent extractions; every regex cross-tested against the pooled "
                  "negative examples of all four. tier1 = compiles, fires on its own positives, "
                  "fires on zero pooled negatives, author confidence high.",
        "counts": {"tier1": len(tier1), "tier2": len(tier2), "tier3_no_regex": len(tier3),
                   "broken_regex": len(broken), "pooled_negatives": len(all_negatives)},
        "tier1": tier1, "tier2": tier2, "tier3": tier3, "broken": broken,
    }
    (ROOT / "skill" / "references" / "negative-set.json").write_text(json.dumps(payload, indent=2))

    print(f'{"tier":7s}{"n":>4s}')
    print(f'{"tier1":7s}{len(tier1):4d}   fail a document')
    print(f'{"tier2":7s}{len(tier2):4d}   flag for a human read')
    print(f'{"tier3":7s}{len(tier3):4d}   no usable regex, prose guidance only')
    print(f'{"broken":7s}{len(broken):4d}   regex did not compile')
    print("\nTIER 1 (enforced):")
    for p in tier1:
        print(f'   {p["name"]:38s} src={p["n_sources"]}  pos={p["fires_on_own_positives"]}')
    print("\nDEMOTED to tier 2, with the reason:")
    for p in tier2[:25]:
        detail = p.get("over_fires_on", [{}])
        eg = detail[0].get("sentence", "")[:66] if detail else ""
        print(f'   {p["name"]:38s} {p.get("demoted","")[:52]}')
        if eg:
            print(f'       fired on: {eg!r}')
    if broken:
        print("\nBROKEN regex:")
        for p in broken:
            print(f'   {p["name"]:38s} {p["compile_error"][:70]}')
    print(f'\n-> {ROOT / "skill" / "references" / "negative-set.json"}')


if __name__ == "__main__":
    main()
