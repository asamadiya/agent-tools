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

# Content-blind stylometry. The surface n-gram score below is reported first and is NOT a style
# measurement: run over this corpus it ranks the real human documents as the MOST over-represented,
# because their top trigrams are iostat column headers ("wkb s avgrq-sz", "w await svctm"). It is
# measuring subject matter, and the conditions differ in subject matter only by accident.
#
# The function-word variant is the standard fix (Koppel et al.): map every content word to a single
# placeholder and keep function words as themselves, so what remains is syntactic rhythm - how
# clauses are joined, where prepositions fall, how often a sentence turns on "but" or "so". Two
# documents about completely different systems can then be compared.
FUNCTION_WORDS = set("""
a an the this that these those there here and or but so yet for nor because since although though
while whereas if unless until when whenever where wherever as than then thus hence therefore however
moreover furthermore also too very much many few more most less least own same such no not only just
in on at by to from with without within into onto upon over under above below between among across
through during before after against about around behind beyond beside despite toward towards off out
up down near per via of is are was were be been being am do does did doing have has had having will
would shall should can could may might must ought it its it's they them their theirs we us our ours
you your yours i me my mine he him his she her hers who whom whose which what when why how all any
both each either neither every some none one two three first second next last other another
""".split())
CONTENT = "<w>"


def tokens(text: str) -> list[str]:
    return TOKEN.findall(text.lower())


def stylometric(toks: list[str]) -> list[str]:
    """Function words kept, everything else collapsed, so content cannot drive the score."""
    return [t if t in FUNCTION_WORDS else CONTENT for t in toks]


def ngrams(toks: list[str], n: int) -> collections.Counter:
    return collections.Counter(tuple(toks[i:i + n]) for i in range(len(toks) - n + 1))


def reference_distribution(mode: str = "surface") -> dict[int, tuple[collections.Counter, int]]:
    manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
    train = set(manifest["split"]["train"])
    out: dict[int, tuple[collections.Counter, int]] = {}
    corpus = " ".join(
        (ROOT / "corpus" / "text" / f'{d["id"]}.txt').read_text(encoding="utf-8", errors="replace")
        for d in manifest["documents"]
        if d["status"] == "ok" and d["family"] in train
    )
    toks = tokens(corpus)
    if mode == "stylometric":
        toks = stylometric(toks)
    for n in NGRAM_SIZES:
        counts = ngrams(toks, n)
        out[n] = (counts, sum(counts.values()))
    return out


def brief_ngrams(mode: str = "surface") -> dict[int, set[tuple[str, ...]]]:
    """n-grams the briefs themselves contain; every condition inherits these equally."""
    briefs = [json.loads(l) for l in (ROOT / "eval" / "prompts.jsonl").read_text().splitlines()]
    blob = " ".join(b["prompt"] + " " + " ".join(f'{f["key"]} {f["value"]}' for f in b.get("facts", [])) for b in briefs)
    toks = tokens(blob)
    if mode == "stylometric":
        # In stylometric space the briefs collapse to the same shapes as everything else, so
        # subtracting them would remove ordinary English syntax from every condition equally.
        return {n: set() for n in NGRAM_SIZES}
    return {n: set(ngrams(toks, n)) for n in NGRAM_SIZES}


def score(texts: list[str], reference: dict, excluded: dict, mode: str = "surface") -> dict:
    result = {}
    toks_all = tokens(" ".join(texts))
    if mode == "stylometric":
        toks_all = stylometric(toks_all)
    for n in NGRAM_SIZES:
        ref_counts, ref_total = reference[n]
        cand = ngrams(toks_all, n)
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

    modes = ["surface", "stylometric"]
    refs = {m: reference_distribution(m) for m in modes}
    excl = {m: brief_ngrams(m) for m in modes}
    root = pathlib.Path(args.outputs)
    conditions = sorted(p.name for p in root.iterdir() if p.is_dir()) if root.exists() else []
    if not conditions:
        raise SystemExit(f"no condition directories under {root}")

    results = {}
    for condition in conditions:
        texts = [p.read_text(encoding="utf-8", errors="replace") for p in sorted((root / condition).glob("*.txt"))]
        results[condition] = {"n_documents": len(texts),
                              **score(texts, refs["surface"], excl["surface"], "surface"),
                              "stylometric": score(texts, refs["stylometric"], excl["stylometric"], "stylometric")}

    payload = {
        "method": {
            "ngram_sizes": list(NGRAM_SIZES),
            "over_representation_factor": OVERREP_FACTOR,
            "min_candidate_count": MIN_CANDIDATE_COUNT,
            "smoothing_k": SMOOTH_K,
            "reference": "train split only",
            "brief_ngrams_excluded": {str(n): len(excl["surface"][n]) for n in NGRAM_SIZES},
            "surface_caveat": "Surface n-grams rank the real human documents as MOST over-represented "
                              "because their top trigrams are iostat column headers. Surface mode "
                              "measures subject matter. Read the stylometric column.",
        },
        "conditions": results,
    }
    pathlib.Path(args.out).write_text(json.dumps(payload, indent=2))

    print(f'{"condition":12s}{"docs":>6s}{"surface%":>11s}{"STYLOMETRIC%":>14s}   (surface measures subject matter)')
    for condition, r in results.items():
        print(f'{condition:12s}{r["n_documents"]:6d}'
              f'{r["headline_over_represented_mass_pct"]:11.4f}'
              f'{r["stylometric"]["headline_over_represented_mass_pct"]:14.4f}')
    print(f"\n-> {args.out}")
    for condition, r in results.items():
        top = r["stylometric"]["3gram"].get("top", [])[:6]
        if top:
            print(f'\n{condition} most over-represented STYLOMETRIC trigrams:')
            for t in top:
                print(f'   x{t["ratio"]:<8.1f} cand={t["candidate_n"]:<4d} train={t["train_n"]:<4d} {t["ngram"]}')


if __name__ == "__main__":
    main()
