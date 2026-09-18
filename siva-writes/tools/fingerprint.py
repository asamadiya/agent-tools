#!/usr/bin/env python3
"""Metric 4: over-represented n-gram ratio against the train corpus.

The question this answers is not "was this written by a machine". It is narrower and checkable:
how much of a candidate's n-gram mass sits in phrases that this corpus of expert human writing
barely uses? A generator with a house style concentrates mass on a small set of connectives and
framings, and that concentration shows up as a ratio even when every individual sentence passes.

Method, following the over-representation approach in the antislop work: build the reference
distribution from the TRAIN corpus only, pool each condition's outputs, and compute for every
candidate n-gram the ratio of its candidate frequency to its reference frequency under add-k
smoothing. The headline number is the share of candidate n-gram tokens sitting in n-grams over
OVERREP_FACTOR. Lower is closer to the reference distribution.

Two guards that decide whether the number means anything:

MIN_CANDIDATE_COUNT. An n-gram appearing once in a condition's whole output is noise, and with
smoothing it can post an enormous ratio. Requiring several occurrences is what separates a house
tic from a one-off phrase.

Brief vocabulary is subtracted. Every condition writes from the same 40 briefs, so every condition
repeats the briefs' proper nouns and technical terms. Those n-grams are over-represented against a
corpus that never saw the briefs, in every condition equally, and they would swamp the signal. The
n-grams that appear in the briefs themselves are therefore excluded before ratios are computed.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
NGRAM_SIZES = (2, 3)
OVERREP_FACTOR = 10.0
MIN_CANDIDATE_COUNT = 3
SMOOTH_K = 0.5

TOKEN = re.compile(r"[a-z][a-z'’\-]*|\d[\d.,]*")


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def ngrams(toks: list[str], n: int) -> collections.Counter:
    return collections.Counter(tuple(toks[i:i + n]) for i in range(len(toks) - n + 1))


def reference_distribution() -> dict[int, tuple[collections.Counter, int]]:
    manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
    train = set(manifest["split"]["train"])
    out: dict[int, tuple[collections.Counter, int]] = {}
    corpus = " ".join(
        (ROOT / "corpus" / "text" / f'{d["id"]}.txt').read_text(encoding="utf-8", errors="replace")
        for d in manifest["documents"]
        if d["status"] == "ok" and d["family"] in train
    )
    toks = tokens(corpus)
    for n in NGRAM_SIZES:
        counts = ngrams(toks, n)
        out[n] = (counts, sum(counts.values()))
    return out


def brief_ngrams() -> dict[int, set[tuple[str, ...]]]:
    """n-grams the briefs themselves contain; every condition inherits these equally."""
    briefs = [json.loads(l) for l in (ROOT / "eval" / "prompts.jsonl").read_text().splitlines()]
    blob = " ".join(b["prompt"] + " " + " ".join(f'{f["key"]} {f["value"]}' for f in b.get("facts", [])) for b in briefs)
    toks = tokens(blob)
    return {n: set(ngrams(toks, n)) for n in NGRAM_SIZES}


def score(texts: list[str], reference: dict, excluded: dict) -> dict:
    result = {}
    for n in NGRAM_SIZES:
        ref_counts, ref_total = reference[n]
        cand = ngrams(tokens(" ".join(texts)), n)
        cand = collections.Counter({g: c for g, c in cand.items() if g not in excluded[n]})
        cand_total = sum(cand.values())
        if not cand_total:
            result[f"{n}gram"] = {"candidate_ngrams": 0}
            continue
        over, mass, top = 0, 0, []
        for gram, count in cand.items():
            if count < MIN_CANDIDATE_COUNT:
                continue
            p_cand = count / cand_total
            p_ref = (ref_counts.get(gram, 0) + SMOOTH_K) / (ref_total + SMOOTH_K * len(ref_counts))
            ratio = p_cand / p_ref
            if ratio >= OVERREP_FACTOR:
                over += 1
                mass += count
                top.append((round(ratio, 1), count, ref_counts.get(gram, 0), " ".join(gram)))
        top.sort(reverse=True)
        result[f"{n}gram"] = {
            "candidate_ngram_tokens": cand_total,
            "distinct_over_represented": over,
            "over_represented_mass_pct": round(100 * mass / cand_total, 4),
            "top": [{"ratio": r, "candidate_n": c, "train_n": t, "ngram": g} for r, c, t, g in top[:25]],
        }
    combined = [result[f"{n}gram"].get("over_represented_mass_pct", 0.0) for n in NGRAM_SIZES]
    result["headline_over_represented_mass_pct"] = round(sum(combined) / len(combined), 4)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--outputs", default=str(ROOT / "eval" / "outputs"),
                        help="directory of <condition>/<brief_id>.txt")
    parser.add_argument("--out", default=str(ROOT / "eval" / "results-metric4.json"))
    args = parser.parse_args()

    reference, excluded = reference_distribution(), brief_ngrams()
    root = pathlib.Path(args.outputs)
    conditions = sorted(p.name for p in root.iterdir() if p.is_dir()) if root.exists() else []
    if not conditions:
        raise SystemExit(f"no condition directories under {root}")

    results = {}
    for condition in conditions:
        texts = [p.read_text(encoding="utf-8", errors="replace") for p in sorted((root / condition).glob("*.txt"))]
        results[condition] = {"n_documents": len(texts), **score(texts, reference, excluded)}

    payload = {
        "method": {
            "ngram_sizes": list(NGRAM_SIZES),
            "over_representation_factor": OVERREP_FACTOR,
            "min_candidate_count": MIN_CANDIDATE_COUNT,
            "smoothing_k": SMOOTH_K,
            "reference": "train split only",
            "brief_ngrams_excluded": {str(n): len(excluded[n]) for n in NGRAM_SIZES},
        },
        "conditions": results,
    }
    pathlib.Path(args.out).write_text(json.dumps(payload, indent=2))

    print(f'{"condition":14s}{"docs":>6s}{"2gram over%":>13s}{"3gram over%":>13s}{"headline":>10s}')
    for condition, r in results.items():
        print(f'{condition:14s}{r["n_documents"]:6d}'
              f'{r["2gram"].get("over_represented_mass_pct", 0):13.4f}'
              f'{r["3gram"].get("over_represented_mass_pct", 0):13.4f}'
              f'{r["headline_over_represented_mass_pct"]:10.4f}')
    print(f"\n-> {args.out}")
    for condition, r in results.items():
        top = r["3gram"].get("top", [])[:6]
        if top:
            print(f'\n{condition} most over-represented trigrams:')
            for t in top:
                print(f'   x{t["ratio"]:<8.1f} cand={t["candidate_n"]:<4d} train={t["train_n"]:<4d} {t["ngram"]}')


if __name__ == "__main__":
    main()
