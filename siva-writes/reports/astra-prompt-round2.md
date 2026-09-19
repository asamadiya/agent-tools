You reviewed this skill in round 1 and returned BLOCKERS: 6. This is round 2. Your round-1 review is
at `reports/astra-round-1.md` in the repository, and every claim in it was independently re-derived
before anything was changed; all six were confirmed.

Repository: /home/spopuri/my_stuff/agent-tools/siva-writes

## First job: classify each repair, not re-review from scratch

For every blocker you raised, say which of these happened:

  discharged             the defect is genuinely fixed
  discharged-but-broken  fixed, and the repair introduced a new problem
  not-addressed          the change does not fix what it claims to fix
  unnecessary            there was no defect; correct material was changed

The third and fourth categories are the point. A repair written quickly by someone who had just
convinced themself they understood the problem is the most likely place for a new defect, and "fixed
it" is the least reliable sentence in the batch. Two of the round-1 repairs to the evaluation were
independently classified discharged-but-broken by a separate pass, so this is not hypothetical.

Here is what was changed, by blocker.

**B1 provenance.** Not fixed, withdrawn. Nine negative-set patterns cite held-out documents in their
exclusion rationales. The strict held-out claim is withdrawn in CHANGELOG.md r2 with a statement of
what it does and does not affect. Judge whether that disclosure is adequate or whether the patterns
must be regenerated.

**B2 claim-first construct validity.** `is_claim_first` is now documented as a lexical proxy in
`tools/measure.py`, SKILL.md and voice.md, the semantic floor is removed, and voice.md states that
both of Rule 1's own "before" examples pass it. The quoted-question bug is fixed. The mechanism and
evaluative classifiers are labelled lexical and the 3-to-1 prescription is softened.

**B3 preprocessing.** The sentence splitter is rewritten: boundaries may now precede lowercase
identifiers, digits and backticks; `re.I` no longer leaks into the lowercase lookahead; personal
titles are removed so `Ms` stops matching the unit `ms`; initial runs must be space-separated.
Every sentence-derived number was recomputed and republished. Check `tools/measure.py` and verify the
numbers in SKILL.md and voice.md against `corpus/measurements-train.json`.

**B4 gate.** `prose-check.py` now fails closed on a missing or non-compiling pattern file;
`install_skill.sh` runs all ten exemplar controls and asserts zero tier-1 hits. Not fixed: the
re.M/multiline issue, the documented-but-unimplemented exceptions, and the truncated regexes in
`negative-set.md`. Tell me which of those still matter.

**B5 voice.md examples.** All five technical errors rewritten, plus Rule 5's third pair and both of
Rule 6's bracketed pseudo-pairs. Re-check the arithmetic and the inferences in every pair, including
the new ones.

**B6 numbers.** Corrected: 161,966 words; PEP claim-first 0.93; hedging highest family mean rather
than highest document; mechanism:evaluative n=27; exemplar ranking scoped to the selected set;
document-weighted versus pooled estimands now labelled throughout.

## Second job: the finding from the evaluation

160 documents were generated across four conditions over 40 held-out briefs, and measured.

**R2 produces the construction it licenses.** Causal "so" per 1000 words: train corpus 0.80,
held-out human 1.14, no skill 2.66, rules only 2.91, rules+exemplars 3.14, full skill 3.46. R3
displaces rather than removes: "rather than" falls from 2.17 to 0.54 while "instead of" rises from
0.41 to 1.29 against 0.36 in the corpus.

**Comprehension, paired per brief, 5 questions each.** C (rules+exemplars) beats D (full skill) by
+0.400 [0.180, 0.620], 17 wins to 3. D does not beat A. B trends below A.

Both rules now carry their measured effect in SKILL.md, and the gate reports all three rates.

Attack this. Specifically: is the causal-"so" measurement sound, or is the regex counting things it
should not? Does the C-over-D result support the conclusion that the brief-then-prose split costs
comprehension, or is there a confound - length, the gate's revision step, the exemplars doing all
the work? What would distinguish them?

## Third job: what is still wrong

Read the current skill and its references fresh. Anything you did not raise in round 1, raise now.
Anything you raised that is now worse, say so.

## How to answer

Lead with the most serious surviving defect. Separate "this is wrong" from "I would have done it
differently". Name what you checked and found clean, so I know coverage rather than only findings.

End with: BLOCKERS: <n>, listed by file. If none, say "BLOCKERS: none" and state what would have to
be true for you to sign this off.
