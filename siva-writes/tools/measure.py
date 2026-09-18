#!/usr/bin/env python3
"""Phase 2 measurement: the seven quantities, computed per document.

Every definition below is a choice, and a different reasonable choice moves the number.
They are written out rather than buried so a reviewer can attack the instrument instead of
arguing with the output. Three of them earn their keep:

Paragraph floor. Extracted pages carry navigation chrome: the SRE book ships its whole table
of contents ahead of chapter one, AWS ships a page-topics list, Marc's blog ships "About Me".
Those are one- to four-word lines. Counting them as paragraphs would drag every mean toward
nav-bar length. Rather than rewrite the stored text and lose provenance, the floor excludes
them at measurement time, and excluded_words reports how much was dropped.

Concreteness OOV. Brysbaert covers general English, not engineering: gpu, throughput, kubelet
and tensor are all absent. Treating an unknown word as abstract would make technical prose look
foggier the more technical it gets, which is the opposite of the truth. The metric is therefore
reported both ways, with the OOV rate beside it. Where the two readings disagree, the number is
not usable, and saying so is the point of computing both.

Coinage rarity. "Hyphenated coinage" is not a property of a token in isolation - context-window
and open-source are standard, thought-shaped and intelligence-forward are not. Rarity across this
corpus is the closest checkable proxy, so a hyphenated token is a coinage when the whole corpus
carries it at most COINAGE_MAX_COUNT times.
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEXT = ROOT / "corpus" / "text"

MIN_PARAGRAPH_WORDS = 25
CONCRETE_MIN = 4.0
COINAGE_MAX_COUNT = 2

# Sentence splitting. Three defects were found by an independent review and are fixed here.
#
# Requiring a capital after the boundary lost every sentence starting with a lowercase identifier,
# a number or a backtick: "Latency fell to 4 ms. p99 stayed flat." scored as one sentence, and this
# corpus is full of p99, kubelet, iostat and `memory.swap.max`.
#
# Abbreviation protection applied unconditionally, so "We checked logs, traces, etc. The queue was
# full." also scored as one. An abbreviation followed by a capital is usually a sentence end; one
# followed by lowercase is usually not. That is a heuristic and it is wrong on "i.e. The", which is
# rare enough to accept.
#
# Single-letter initials are protected only inside a run of initials, so "J. R. R. Tolkien" holds
# together while "The service runs in the U.S. It handles writes." splits.
ABBREVIATIONS = (
    "vs cf al Fig Figs Eq Eqs No Nos Inc Ltd Co Corp approx "
    "ca resp Ch Sec Vol pp Ref Refs Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec"
).split()
DOT = "\x00"
# Case-insensitivity is scoped to the abbreviation alternation. Applying re.I to the whole pattern
# made the lowercase-only lookahead match capitals too, so "etc. The" was protected and the
# sentence never split. Personal titles are omitted: "Ms." is always followed by a capitalised
# name, which this lookahead already refuses to protect, and keeping it made "4 ms. p99" match.
PROTECT_ABBREV = re.compile(
    r"\b(?i:(" + "|".join(ABBREVIATIONS) + r"|i\.e|e\.g|etc|U\.S|U\.K|E\.U))\.(?=\s+[a-z0-9(])")
PROTECT_DECIMAL = re.compile(r"(\d)\.(?=\d)")
# A run of SPACE-SEPARATED single-letter initials: "J. R. R. Tolkien". The spacing requirement is
# what separates it from a dotted acronym - "U.S." is written closed up and is handled above, where
# a following capital correctly ends the sentence. "J.R.R." written closed up will split, which is
# the rarer case in technical prose and is the residual limitation here.
INITIAL_RUN = re.compile(r"\b(?:[A-Z]\.\s+){1,}[A-Z]\.")
SENT_SPLIT = re.compile(r"[.!?]+[\"'’”)\]]*\s+(?=[A-Za-z0-9\"'“(\[`])")
# A boundary may be followed by a capital, a quote, a bracket, a lowercase identifier, a digit or
# a backtick. Requiring a capital was the single largest source of missed boundaries.
SENT_SPLIT = re.compile(r"[.!?]+[\"'’”)\]]*\s+(?=[A-Za-z0-9\"'“(\[`])")

WORD = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
# A numeric literal: integers, decimals, thousands-separated, percentages, versions, times.
NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s*%)?(?![\w])")
HYPHENATED = re.compile(r"\b[a-z]{2,}-[a-z]{2,}(?:-[a-z]{2,})*\b")

HEDGES = {
    "arguably", "basically", "essentially", "fairly", "generally", "largely", "likely", "mainly",
    "maybe", "mostly", "perhaps", "possibly", "presumably", "probably", "quite", "rather",
    "relatively", "roughly", "seemingly", "several", "somewhat", "sort", "kind", "typically",
    "usually", "virtually", "apparently", "conceivably", "ostensibly", "reportedly", "supposedly",
    "often", "sometimes", "occasionally", "tends", "tend", "suggests", "suggest", "appears",
    "appear", "seems", "seem", "might", "could", "may", "potentially", "approximately", "around",
    "about", "nearly", "almost", "slightly", "marginally", "reasonably", "broadly", "loosely",
}

# Evaluative vocabulary: words that assert quality without measuring it.
EVALUATIVE = {
    "important", "crucial", "significant", "powerful", "robust", "elegant", "seamless", "vital",
    "remarkable", "compelling", "essential", "key", "critical", "revolutionary", "groundbreaking",
    "comprehensive", "innovative", "sophisticated", "impressive", "excellent", "outstanding",
    "superior", "cutting-edge", "state-of-the-art", "game-changing", "world-class", "best-in-class",
    "profound", "invaluable", "unparalleled", "exceptional", "notable", "noteworthy", "striking",
    "dramatic", "massive", "huge", "enormous", "tremendous", "incredible", "amazing", "great",
    "beautiful", "clean", "nice", "wonderful", "fantastic", "solid", "strong", "rich", "deep",
}

CAUSAL = re.compile(
    r"\b(because|since|so that|therefore|thus|hence|consequently|as a result|which means|"
    r"due to|owing to|leads? to|causes?|caused|results? in|resulting in|so\b|that is why|"
    r"the reason|follows? from|implies|implying)\b",
    re.I,
)

# Sentence-initial discourse connectives and metadiscourse. A paragraph whose first sentence
# opens with one of these is orienting the reader rather than stating the paragraph's claim.
CONNECTIVE_OPENERS = re.compile(
    r"^\s*(however|but|and|so|also|moreover|furthermore|in addition|additionally|that said|"
    r"nevertheless|nonetheless|meanwhile|similarly|likewise|conversely|on the other hand|"
    r"first|firstly|second|secondly|third|thirdly|next|then|finally|lastly|in conclusion|"
    r"to summari[sz]e|in summary|for example|for instance|in other words|as mentioned|"
    r"as discussed|as noted|as we saw|now|well|of course|indeed|in fact|overall)\b",
    re.I,
)
METADISCOURSE = re.compile(
    r"\b(this (section|chapter|post|article|document|paper|page|blog|part|piece)|"
    r"the (following|preceding|rest of this|remainder of this)|"
    r"in this (section|chapter|post|article|document|paper|part)|"
    r"we will (discuss|cover|explore|look at|examine|describe|explain)|"
    r"let'?s (look|explore|dive|examine|consider|start)|"
    r"here we (will|discuss|describe)|what follows)\b",
    re.I,
)


def load_concreteness() -> dict[str, tuple[float, str]]:
    path = ROOT / "corpus" / "lexicons" / "brysbaert_concreteness.tsv"
    table: dict[str, tuple[float, str]] = {}
    with path.open(newline="", encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            try:
                table[row["Word"].lower()] = (float(row["Conc.M"]), row["Dom_Pos"])
            except (ValueError, KeyError):
                continue
    return table


def paragraphs(text: str) -> tuple[list[str], int]:
    """Qualifying prose paragraphs, plus the word count excluded as chrome."""
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    keep, dropped = [], 0
    for block in blocks:
        flat = " ".join(block.split())
        if len(WORD.findall(flat)) >= MIN_PARAGRAPH_WORDS:
            keep.append(flat)
        else:
            dropped += len(WORD.findall(flat))
    return keep, dropped


def sentences(paragraph: str) -> list[str]:
    guarded = PROTECT_ABBREV.sub(lambda m: m.group(1) + DOT, paragraph)
    guarded = PROTECT_DECIMAL.sub(lambda m: m.group(1) + DOT, guarded)
    guarded = INITIAL_RUN.sub(lambda m: m.group().replace(".", DOT), guarded)
    # Slice at the boundary rather than consuming it: the terminator has to stay attached to the
    # sentence it ends, or a paragraph-opening question loses its question mark and the claim-first
    # classifier counts it as a claim.
    out, prev = [], 0
    for match in SENT_SPLIT.finditer(guarded):
        out.append(guarded[prev:match.start()] + match.group().rstrip())
        prev = match.end()
    out.append(guarded[prev:])
    parts = [s.strip().replace(DOT, ".") for s in out if s.strip()]
    return [s for s in parts if WORD.search(s)]


def stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def is_claim_first(first: str) -> bool:
    """A LEXICAL PROXY, not a semantic judgement. Read the name as "survives four exclusions".

    An independent review supplied counterexamples this returns the wrong answer on, and two of them
    are voice.md's own teaching examples: "Before discussing the retry policy, it is worth
    considering..." and "There are a number of factors that influence..." both pass. It does not
    establish that the sentence states a claim, only that it does not open with a connective, does
    not take the document as its subject, is not a question, and is not very short.

    Anything derived from this is a statement about that filter, not about paragraph organisation.
    """
    stripped = first.rstrip().rstrip("\"'’”)]")
    if stripped.endswith("?"):
        return False
    if len(WORD.findall(first)) < 5:
        return False
    if CONNECTIVE_OPENERS.search(first):
        return False
    if METADISCOURSE.search(first):
        return False
    return True


def words_to_first_concrete(sentence: str, conc: dict, oov_concrete: bool) -> int | None:
    """Index of the first concrete noun, or None if the sentence has none."""
    tokens = WORD.findall(sentence)
    for index, token in enumerate(tokens):
        low = token.lower()
        if low in conc:
            score, pos = conc[low]
            if score >= CONCRETE_MIN and pos == "Noun":
                return index
        elif oov_concrete and len(low) > 2 and low not in HEDGES:
            # Out of vocabulary. Under this reading a domain noun such as kubelet or GPU counts
            # as concrete; the other reading is computed alongside so the gap stays visible.
            return index
    return None


def measure(doc_id: str, text: str, conc: dict, coinages: set[str]) -> dict:
    paras, excluded = paragraphs(text)
    if not paras:
        return {"id": doc_id, "status": "no qualifying paragraphs", "paragraphs": 0}

    all_sentences: list[str] = []
    claim_first = 0
    for para in paras:
        sents = sentences(para)
        if not sents:
            continue
        all_sentences.extend(sents)
        if is_claim_first(sents[0]):
            claim_first += 1

    lengths = [len(WORD.findall(s)) for s in all_sentences]
    para_lengths = [len(WORD.findall(p)) for p in paras]
    # A two-column PDF extract arrives as hard-wrapped lines with no blank-line paragraph breaks,
    # so every "paragraph" is a whole column. That document's paragraph metrics are artifacts -
    # The Tail at Scale scores claim_first_share 1.000 on six 818-word blocks - and averaging them
    # in would let an extraction failure set a rule. Sentence and token metrics are unaffected.
    para_reliable = sum(para_lengths) / len(para_lengths) <= 300
    body = " ".join(paras)
    tokens = WORD.findall(body)
    total = len(tokens)
    lowered = [t.lower() for t in tokens]

    hedges = sum(1 for t in lowered if t in HEDGES)
    evaluative_tokens = sum(1 for t in lowered if t in EVALUATIVE)
    numbers = len(NUMBER.findall(body))
    coinage_hits = sum(1 for h in HYPHENATED.findall(body.lower()) if h in coinages)

    mechanism = sum(1 for s in all_sentences if CAUSAL.search(s))
    evaluative_sentences = sum(
        1
        for s in all_sentences
        if any(w.lower() in EVALUATIVE for w in WORD.findall(s)) and not NUMBER.search(s)
    )

    oov = sum(1 for t in lowered if t not in conc)
    first_conc_oov_concrete = [
        i for s in all_sentences if (i := words_to_first_concrete(s, conc, True)) is not None
    ]
    first_conc_strict = [
        i for s in all_sentences if (i := words_to_first_concrete(s, conc, False)) is not None
    ]

    def mean(values: list) -> float:
        return round(sum(values) / len(values), 3) if values else 0.0

    return {
        "id": doc_id,
        "status": "ok",
        "words": total,
        "excluded_chrome_words": excluded,
        "paragraphs": len(paras),
        "sentences": len(all_sentences),
        "sentence_len_mean": mean(lengths),
        "sentence_len_sd": round(stdev([float(x) for x in lengths]), 3),
        "sentences_over_30w_pct": round(100 * sum(1 for x in lengths if x > 30) / len(lengths), 2) if lengths else 0.0,
        "paragraph_segmentation_reliable": para_reliable,
        "paragraph_len_mean": mean(para_lengths),
        "paragraphs_over_120w_pct": round(100 * sum(1 for p in para_lengths if p > 120) / len(paras), 2),
        "claim_first_share": round(claim_first / len(paras), 3),
        "numbers_per_100w": round(100 * numbers / total, 3) if total else 0.0,
        "hedges_per_100w": round(100 * hedges / total, 3) if total else 0.0,
        "evaluative_per_100w": round(100 * evaluative_tokens / total, 3) if total else 0.0,
        "coinages_per_100w": round(100 * coinage_hits / total, 3) if total else 0.0,
        "words_before_concrete_oov_concrete": mean(first_conc_oov_concrete),
        "words_before_concrete_strict": mean(first_conc_strict),
        "sentences_with_no_concrete_noun_pct": round(100 * (len(all_sentences) - len(first_conc_strict)) / len(all_sentences), 2) if all_sentences else 0.0,
        "lexicon_oov_pct": round(100 * oov / total, 2) if total else 0.0,
        "mechanism_sentences": mechanism,
        "evaluative_sentences": evaluative_sentences,
        "mechanism_to_evaluative": round(mechanism / evaluative_sentences, 3) if evaluative_sentences else None,
        "mechanism_sentence_pct": round(100 * mechanism / len(all_sentences), 2) if all_sentences else 0.0,
    }


# Metrics computed over paragraphs rather than sentences or tokens. A document whose paragraph
# segmentation failed contributes nothing to these, and the count of such documents is reported.
PARAGRAPH_LEVEL = {"claim_first_share", "paragraph_len_mean", "paragraphs_over_120w_pct"}


def aggregate(rows: list[dict], key: str) -> dict:
    eligible = [
        r for r in rows
        if r.get("status") == "ok"
        and isinstance(r.get(key), (int, float))
        and (key not in PARAGRAPH_LEVEL or r.get("paragraph_segmentation_reliable", True))
    ]
    values = sorted(r[key] for r in eligible)
    excluded = sum(
        1 for r in rows
        if r.get("status") == "ok" and key in PARAGRAPH_LEVEL and not r.get("paragraph_segmentation_reliable", True)
    )
    if not values:
        return {"n": 0, "excluded_unreliable_segmentation": excluded}
    return {
        "n": len(values),
        "excluded_unreliable_segmentation": excluded,
        "mean": round(sum(values) / len(values), 3),
        "sd": round(stdev([float(v) for v in values]), 3),
        "min": round(values[0], 3),
        "p50": round(values[len(values) // 2], 3),
        "max": round(values[-1], 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--splits", nargs="+", default=["train"],
                        help="which splits to measure; keep test out until eval time")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    manifest = json.loads((ROOT / "corpus" / "manifest.json").read_text())
    split = manifest["split"]
    wanted = {f for s in args.splits for f in split.get(s, [])}
    docs = [d for d in manifest["documents"] if d["status"] == "ok" and d["family"] in wanted]
    conc = load_concreteness()

    texts = {d["id"]: (TEXT / f'{d["id"]}.txt').read_text(encoding="utf-8", errors="replace") for d in docs}
    corpus_hyphens = collections.Counter()
    for text in texts.values():
        corpus_hyphens.update(HYPHENATED.findall(text.lower()))
    coinages = {h for h, c in corpus_hyphens.items() if c <= COINAGE_MAX_COUNT}

    rows = []
    for doc in docs:
        row = measure(doc["id"], texts[doc["id"]], conc, coinages)
        row["family"] = doc["family"]
        row["genre"] = doc["genre"]
        rows.append(row)

    metrics = [
        "sentence_len_mean", "sentence_len_sd", "sentences_over_30w_pct", "paragraph_len_mean",
        "paragraphs_over_120w_pct", "claim_first_share", "numbers_per_100w", "hedges_per_100w",
        "evaluative_per_100w", "coinages_per_100w", "words_before_concrete_oov_concrete",
        "words_before_concrete_strict", "sentences_with_no_concrete_noun_pct", "lexicon_oov_pct",
        "mechanism_to_evaluative", "mechanism_sentence_pct",
    ]
    by_family: dict[str, dict] = {}
    for family in sorted({r["family"] for r in rows}):
        subset = [r for r in rows if r["family"] == family]
        by_family[family] = {m: aggregate(subset, m) for m in metrics}

    out = {
        "splits_measured": args.splits,
        "definitions": {
            "min_paragraph_words": MIN_PARAGRAPH_WORDS,
            "concrete_min": CONCRETE_MIN,
            "coinage_max_corpus_count": COINAGE_MAX_COUNT,
            "coinage_examples": sorted(coinages)[:40],
            "n_coinage_types": len(coinages),
        },
        "overall": {m: aggregate(rows, m) for m in metrics},
        "by_family": by_family,
        "documents": rows,
    }
    path = pathlib.Path(args.out or ROOT / "corpus" / f'measurements-{"-".join(args.splits)}.json')
    path.write_text(json.dumps(out, indent=2))

    print(f'{len(rows)} documents, splits={args.splits} -> {path}\n')
    print(f'{"metric":42s} {"mean":>9s} {"sd":>8s} {"min":>8s} {"p50":>8s} {"max":>8s}')
    for m in metrics:
        a = out["overall"][m]
        if a["n"]:
            print(f'{m:42s} {a["mean"]:9.3f} {a["sd"]:8.3f} {a["min"]:8.3f} {a["p50"]:8.3f} {a["max"]:8.3f}')


if __name__ == "__main__":
    main()
