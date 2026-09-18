#!/usr/bin/env python3
"""
prose-check -- the mechanical half of the siva-writes acceptance gate.

Runs G1, G2, G4, G5, G6 and G10 over one or more markdown/text files, plus G3
(repeated headings) across the whole set. The structural checks (G7 figure
density, G8 why/why-not/what-else, G9 canonical example) are not mechanical and
are not attempted here; a green run is necessary, never sufficient.

Two design notes worth keeping:

  * Prose only. Fenced code, YAML front matter, tables, and `:::` directive
    bodies are stripped before counting, because a `--` inside a shell command
    is not an em dash and a hedge inside a quoted source is the source's, not
    the author's. Counting them was the first version's bug: it reported 9.4
    dashes per 1000 words on a file whose prose had 1.8.

  * Verbatim quotations are excluded too (blockquote lines). You may not edit a
    quotation to satisfy a style gate, so measuring it only produces findings
    you must then dismiss.

Usage:  prose-check.py FILE [FILE...]
Exit code is the number of files with at least one violation.
"""
import re
import sys
import statistics
from pathlib import Path

HEDGES = r"""roughly|somewhat|arguably|tends? to|generally|more or less|effectively|
essentially|in some sense|fairly|rather|quite|relatively|approximately|
sort of|kind of|to some extent|by and large|for the most part""".replace("\n", "")

META_SUBJECT = re.compile(
    r"\b(?:this|the|our)\s+(?:chapter|section|article|paper|document|post|"
    r"discussion|analysis|essay|piece|guide|handbook)\b", re.I)
META_OPENER = re.compile(
    r"^\s*(?:what follows|the rest of|in this (?:chapter|section)|"
    r"the (?:preceding|previous|following) (?:paragraph|section|discussion)|"
    r"it is (?:important|worth) (?:to note|noting)|note that|"
    r"as (?:discussed|mentioned|noted) (?:above|below|earlier))", re.I)

ABSTRACT_SUBJ = re.compile(
    r"^\s*(?:the\s+)?\w*(?:ance|ence|ment|ation|ition|ility|ness|ivity|"
    r"ing)\b", re.I)


def strip_noncprose(text: str) -> str:
    # ORDER MATTERS, and getting it wrong is invisible. The directive sub must
    # run BEFORE the horizontal-rule sub: `[-|: ]{3,}` matches a bare `:::`
    # line, so stripping rules first eats a directive's closing fence and the
    # `^:::.*?^:::` sub can then never match. Every figure caption in the
    # corpus was being counted as prose because of that ordering. The rule sub
    # now also refuses a line that is only colons.
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.S)      # front matter
    text = re.sub(r"```.*?```", " ", text, flags=re.S)            # fenced code
    text = re.sub(r"^:::.*?^:::", " ", text, flags=re.S | re.M)   # directives
    text = re.sub(r"^\s*(?=[-|])[-|: ]{3,}\s*$", " ", text, flags=re.M)  # hr + table rules
    text = re.sub(r"^\s*\|.*$", " ", text, flags=re.M)            # tables
    text = re.sub(r"^\s*>.*$", " ", text, flags=re.M)             # quotations
    text = re.sub(r"`[^`]*`", " ", text)                          # inline code
    text = re.sub(r"^\s*#{1,6}\s.*$", " ", text, flags=re.M)      # headings
    return text


def sentences(prose: str):
    for s in re.split(r"(?<=[.!?])\s+", prose):
        s = " ".join(s.split())
        if len(s.split()) >= 3:
            yield s


def check(path: Path):
    raw = path.read_text(errors="replace")
    prose = strip_noncprose(raw)
    words = len(prose.split())
    if not words:
        return [], [], 0
    per_k = lambda n: n * 1000.0 / words

    sents = list(sentences(prose))
    if not sents:
        # A file whose every sentence is under the three-word floor. Reported
        # rather than crashed: `statistics.mean([])` raised StatisticsError on
        # a file containing only "Only two."
        return [], {}, f"{words}w  0 measurable sentences"
    # the CONSTRUCTION, not the glyph: Jalammar scores 0.00 em dashes per 1000 words
    # and 3.6-5.2 dash constructions, because he writes the break with an en dash.
    # Numeric ranges (6:31-88, pp. 10-14) are excluded: they are not interruptions.
    dashes = len(re.findall(r"(?<=[A-Za-z,)])\s*(?:(?<!-)--(?!-)|[—–])\s*(?=[A-Za-z(])", prose))
    meta = [s for s in sents if META_SUBJECT.search(s) or META_OPENER.match(s)]
    stacked = [s for s in sents
               if len(re.findall(HEDGES, s, re.I)) >= 2]
    lengths = [len(s.split()) for s in sents]
    longs = [s for s in sents if len(s.split()) > 45]
    abstract = [s for s in sents if ABSTRACT_SUBJ.match(s)]

    # ADVISORY ONLY. The standard says one rule can fail a document -- G3, the
    # uniqueness constraint -- and everything else is a review trigger. A Tech
    # Fellow review found the checker still returning failures for G1, G2, G4,
    # G5 and G6 while the standard said nothing but G3 could fail, and called
    # that what it was: three contradictory contracts in one artefact. These
    # are now reported and never counted.
    fails = []
    if per_k(dashes) > 6:
        fails.append(f"G1 dash constructions {per_k(dashes):.1f}/1k (review trigger >6) -- {dashes} total")
    if meta:
        fails.append(f"G2 metadiscourse {len(meta)} sentence(s) -- review, does not fail")
    if stacked:
        fails.append(f"G4 stacked qualifiers {len(stacked)} sentence(s) -- review, does not fail")
    if per_k(len(longs)) > 1:
        fails.append(f"G5 sentences >45w: {per_k(len(longs)):.1f}/1k (review each) -- {len(longs)} total")
    if sents and len(abstract) / len(sents) > 0.30:
        fails.append(f"G6 subjects to review {len(abstract)/len(sents):.0%} -- suffix-based, unreliable; does not fail")

    ex = {"G2": meta[:3], "G4": stacked[:3], "G5": longs[:2], "G6": abstract[:3]}
    stats = (f"{words}w  {len(sents)}sent  mean {statistics.mean(lengths):.0f}w  "
             f"p90 {sorted(lengths)[int(len(lengths)*0.9)]}w  dash {per_k(dashes):.1f}/1k")
    return fails, ex, stats


def main(argv):
    paths = [Path(a) for a in argv]
    headings, bad = {}, 0
    for p in paths:
        fails, ex, stats = check(p)
        for h in re.findall(r"^#{1,6}\s+(.+?)\s*$", p.read_text(errors="replace"), re.M):
            headings.setdefault(re.sub(r"\s*\{#[\w-]+\}$", "", h).strip(), []).append(p.name)
        mark = "note" if fails else " ok "
        print(f"[{mark}] {p}  ({stats})")
        for f in fails:
            print(f"         {f}")
            key = f.split()[0]
            for s in ex.get(key, []):
                print(f"           > {s[:150]}")
        # G1-G12 are advisory; only G3 below moves the exit code.

    dupes = {h: fs for h, fs in headings.items() if len(fs) > 1}
    if dupes:
        print(f"\n[FAIL] G3 repeated headings: {len(dupes)} distinct string(s)")
        for h, fs in sorted(dupes.items(), key=lambda kv: -len(kv[1]))[:10]:
            print(f"         {len(fs):>3}x  {h!r}")
        bad += 1
    else:
        print("\n[ ok ] G3 no heading repeated across the set")
    return bad


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
