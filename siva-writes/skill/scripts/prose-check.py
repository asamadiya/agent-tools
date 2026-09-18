#!/usr/bin/env python3
"""The stage-3 gate for siva-writes.

What fails and what only reports is the whole design of this script, and the split follows the
measurements in references/voice.md rather than intuition.

FAILS: things that are a violated constraint, checkable with near-zero false positives - a prose
em dash under R11, more than one "so" in a sentence under R2, a tier-1 negative-set pattern.

REPORTS: everything whose corpus spread makes a threshold dishonest. 22.8% of sentences in expert
engineering writing run over 30 words and 47% of danluu's do, so a length cap would fail the corpus
it was derived from. 17.2% of measured paragraphs exceed 120 words. Numbers per 100 words has a
standard deviation almost equal to its mean. For these the script tells you where to look and
refuses to pretend it knows the answer.

A clean report is not approval. Nothing here detects a document that states its mechanism and never
states its purpose.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SKILL = HERE.parent
sys.path.insert(0, str(SKILL.parent / "tools"))

try:
    from measure import WORD, is_claim_first, paragraphs, sentences  # reuse the measured instrument
except ImportError:  # the skill may be installed without the repo's tools/ beside it
    WORD = re.compile(r"[A-Za-z][A-Za-z'’\-]*")

    def paragraphs(text):
        blocks = [" ".join(b.split()) for b in re.split(r"\n\s*\n", text) if b.strip()]
        keep = [b for b in blocks if len(WORD.findall(b)) >= 25]
        return keep, sum(len(WORD.findall(b)) for b in blocks if b not in keep)

    def sentences(p):
        return [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", p) if s.strip()]

    def is_claim_first(s):
        return not s.rstrip().endswith("?") and len(WORD.findall(s)) >= 5

CORPUS = {  # from corpus/measurements-train.json, train split, n=30 documents
    "claim_first_mean": 0.893, "claim_first_floor": 0.758,
    "sent_over_30_pct": 22.77, "para_over_120_pct": 17.23,
    "numbers_per_100w_mean": 1.334, "numbers_per_100w_sd": 1.267,
    "hedges_per_100w_mean": 1.383,
}

# A comparative claim with no quantity anywhere in its sentence. This is the "quantified claims"
# axis: not a density target, but a claim that rests on a magnitude and does not supply it.
COMPARATIVE = re.compile(
    r"\b(faster|slower|larger|smaller|higher|lower|better|worse|cheaper|more efficient|"
    r"less efficient|improved|degraded|reduced|increased|outperform\w*|significantly|"
    r"substantially|dramatically|considerably|far more|far less)\b", re.I)
NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?(?:\s*%)?(?![\w])")
EM_DASH = re.compile(r"—")
QUOTE_LINE = re.compile(r"^\s*>")
SO_COUNT = re.compile(r"\bso\b", re.I)
RATHER_THAN = re.compile(r"\brather than\b", re.I)


def load_patterns() -> dict:
    path = SKILL / "references" / "negative-set.json"
    if not path.exists():
        return {"tier1": [], "tier2": [], "note": "negative-set.json absent; pattern checks skipped"}
    return json.loads(path.read_text())


def code_spans(text: str) -> list[tuple[int, int]]:
    spans = [(m.start(), m.end()) for m in re.finditer(r"```.*?```", text, re.S)]
    spans += [(m.start(), m.end()) for m in re.finditer(r"`[^`\n]+`", text)]
    return spans


def outside_code(text: str, pos: int, spans) -> bool:
    return not any(a <= pos < b for a, b in spans)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--brief", help="path to the stage-1 brief, to check the opening claim")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    text = pathlib.Path(args.file).read_text(encoding="utf-8", errors="replace")
    # HTML comments carry provenance headers and editorial notes, not prose. Left in, the first
    # one becomes the document's "opening sentence" and its words enter every rate.
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    spans = code_spans(text)
    paras, chrome = paragraphs(text)
    if not paras:
        raise SystemExit("no paragraphs of 25+ words; nothing to check")

    sents = [s for p in paras for s in sentences(p)]
    words = len(WORD.findall(" ".join(paras)))
    failures, reports = [], []

    # ---- FAIL: R11, prose em dash outside code and outside quotation blocks.
    quoted = {i for i, line in enumerate(text.split("\n")) if QUOTE_LINE.match(line)}
    offsets, pos = {}, 0
    for i, line in enumerate(text.split("\n")):
        offsets[i] = pos
        pos += len(line) + 1
    dashes = [m.start() for m in EM_DASH.finditer(text) if outside_code(text, m.start(), spans)]
    dashes = [d for d in dashes if text[:d].count("\n") not in quoted]
    if dashes:
        failures.append(("R11 prose em dash", len(dashes), "use ASCII ' -- ', or preserve and label a quotation"))

    # ---- FAIL: R2, more than one "so" per sentence.
    multi_so = [s for s in sents if len(SO_COUNT.findall(s)) > 1]
    if multi_so:
        failures.append(("R2 more than one 'so' in a sentence", len(multi_so), multi_so[0][:90]))

    # ---- FAIL: tier-1 negative-set patterns.
    patterns = load_patterns()
    for p in patterns.get("tier1", []):
        rx = p.get("regex") or ""
        if not rx:
            continue
        try:
            hits = [m for m in re.finditer(rx, text, re.I) if outside_code(text, m.start(), spans)]
        except re.error:
            reports.append(("negative-set regex did not compile", p.get("name", "?"), rx[:60]))
            continue
        if hits:
            failures.append((f'tier-1 pattern: {p.get("name")}', len(hits),
                             f'{hits[0].group()[:60]!r} -> {p.get("repair", "")[:70]}'))

    # ---- FAIL: R3, more than one "rather than" per document.
    rt = RATHER_THAN.findall(text)
    if len(rt) > 1:
        failures.append(("R3 'rather than' budget", len(rt), "at most one per rendered page"))

    # ---- REPORT: claim-first share.
    claim_first = sum(1 for p in paras if is_claim_first(sentences(p)[0]))
    share = claim_first / len(paras)
    verdict = "below the entire measured corpus" if share < CORPUS["claim_first_floor"] else "within corpus range"
    reports.append(("claim-first paragraphs", f'{share:.3f} ({claim_first}/{len(paras)})',
                    f'corpus mean {CORPUS["claim_first_mean"]}, floor {CORPUS["claim_first_floor"]} - {verdict}'))

    # ---- REPORT: comparative claims carrying no quantity.
    bare = [s for s in sents if COMPARATIVE.search(s) and not NUMBER.search(s)]
    reports.append(("comparative claims with no quantity in the sentence", len(bare),
                    bare[0][:90] if bare else "none"))
    numbers = len(NUMBER.findall(" ".join(paras)))
    reports.append(("numbers per 100 words", f'{100 * numbers / words:.2f}',
                    f'corpus mean {CORPUS["numbers_per_100w_mean"]} sd {CORPUS["numbers_per_100w_sd"]} - no target, spread is the finding'))

    # ---- REPORT: long sentences, for clause-resolution review only.
    lengths = [len(WORD.findall(s)) for s in sents]
    over45 = [s for s, n in zip(sents, lengths) if n > 45]
    over30 = sum(1 for n in lengths if n > 30)
    reports.append(("sentences over 45 words", len(over45), "read each: does every clause resolve as it arrives?"))
    reports.append(("sentences over 30 words", f'{100 * over30 / len(sents):.1f}%',
                    f'corpus {CORPUS["sent_over_30_pct"]}% - NOT a cap; danluu runs 47%'))
    sd = (sum((n - sum(lengths) / len(lengths)) ** 2 for n in lengths) / max(1, len(lengths) - 1)) ** 0.5
    reports.append(("sentence-length sd", f'{sd:.2f}', "corpus within-document mean 13.59; under ~7 reads mechanical"))

    # ---- REPORT: long paragraphs.
    plens = [len(WORD.findall(p)) for p in paras]
    over120 = [p for p, n in zip(paras, plens) if n > 120]
    reports.append(("paragraphs over 120 words", f'{len(over120)} ({100 * len(over120) / len(paras):.1f}%)',
                    f'corpus {CORPUS["para_over_120_pct"]}% - look for two claims in one paragraph, not length'))

    # ---- REPORT: opening sentence, and the brief's claim if supplied.
    opening = sentences(paras[0])[0]
    reports.append(("opening sentence", opening[:100], "must state the brief's claim"))
    if args.brief:
        brief = pathlib.Path(args.brief).read_text(encoding="utf-8", errors="replace")
        m = re.search(r"claim\s*[:\-]\s*(.+)", brief, re.I)
        if m:
            claim_words = {w.lower() for w in WORD.findall(m.group(1)) if len(w) > 4}
            opening_words = {w.lower() for w in WORD.findall(opening)}
            overlap = len(claim_words & opening_words) / max(1, len(claim_words))
            reports.append(("opening overlaps the brief's claim", f'{overlap:.2f}',
                            "low overlap means the document opens on something the brief did not commit to"))

    # ---- REPORT: repeated paragraph openings (R10).
    openers = [" ".join(WORD.findall(sentences(p)[0])[:2]).lower() for p in paras]
    dupes = {o: openers.count(o) for o in set(openers) if openers.count(o) > 1 and o}
    if dupes:
        reports.append(("repeated paragraph openings", len(dupes), ", ".join(f"{k} x{v}" for k, v in sorted(dupes.items(), key=lambda x: -x[1])[:5])))

    # ---- REPORT: tier-2 patterns, for a human read.
    for p in patterns.get("tier2", []):
        rx = p.get("regex") or ""
        if not rx:
            continue
        try:
            hits = [m for m in re.finditer(rx, text, re.I) if outside_code(text, m.start(), spans)]
        except re.error:
            continue
        if hits:
            reports.append((f'tier-2 pattern: {p.get("name")}', len(hits), f'{hits[0].group()[:60]!r}'))

    if args.json:
        print(json.dumps({"file": args.file, "words": words, "paragraphs": len(paras),
                          "sentences": len(sents), "failures": failures, "reports": reports}, indent=2))
    else:
        print(f'{args.file}   {words} words, {len(paras)} paragraphs, {len(sents)} sentences'
              f'  ({chrome} words excluded as chrome)\n')
        print("FAIL" if failures else "FAIL  none")
        for name, n, detail in failures:
            print(f'   {name:52s} {str(n):>5s}  {detail}')
        print("\nREPORT  (no threshold; read these)")
        for name, n, detail in reports:
            print(f'   {name:52s} {str(n):>5s}  {detail}')
        print("\nA clean report is not approval. No count here detects a document that states its"
              "\nmechanism and never states its purpose.")

    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
