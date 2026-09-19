# CHANGELOG

`~/.claude/skills/siva-writes` is a symlink to `skill/` in this repository, so every commit here is
live immediately. Run `bash tools/install_skill.sh` after any change: it validates the frontmatter,
checks that every referenced file exists, runs the gate against a human exemplar, and compiles every
negative-set regex before swapping. It refuses to install rather than leaving a broken skill in place.

The pre-change skill is preserved at `baseline/skill-v0/` (1571-line SKILL.md) and is not
discoverable as a skill.

---

## r3 -- 2026-09-19 -- round 2, a second review, and three of my own instruments found wrong

`gpt-6-astra` reviewed again and returned **BLOCKERS: 8**, more than round 1, and classified several
r2 repairs as discharged-but-broken. Every checkable claim was re-derived before acting. It was
right again, including about three defects in measurement code I had written to check other things.

### What Phase 5 established

One change was made and B, C and D were regenerated over the same frozen briefs: R2 and R3 now carry
their measured effect, and the gate reports the three construction rates.

| | r1 | r2 | paired diff /5 | verdict |
|---|---|---|---|---|
| B rules only | 61.5% | **72.5%** | +0.550 [+0.007, +1.093] | **moved beyond CI** |
| C +exemplars | 73.0% | 67.5% | -0.275 [-0.581, +0.031] | not beyond CI |
| D full skill | 64.0% | 57.5% | -0.325 [-0.718, +0.068] | not beyond CI |

**C beats D in both rounds**: +0.450 [0.197, 0.703] and +0.500 [0.097, 0.903]. The result replicates
on an independent generation and survives a regrade. That answers the question the original brief
posed: D does not separate from C, so the brief-then-prose split is not doing what it was designed
to do. D also ties A exactly (+0.000).

Causal *so* per 1000 words in D went **3.50 to 1.17**, below held-out human at 1.38 and near the
corpus at 0.87. It did not move in B or C. The rule text was identical in all three; only D runs the
gate. **A rule read before writing lost to a number shown after writing.**

### r2's headline claim was an artifact, and is withdrawn

r2 said the skill drives causal *so* up monotonically. The detector applied `^` to the whole joined
document rather than per sentence, so every sentence-initial *So* after the first was missed, and it
counted degree uses such as *so deep that it broke the profiler*. Corrected and counted per sentence:

| | corpus | human | A no skill | B | C | D |
|---|---|---|---|---|---|---|
| causal *so* | 0.87 | 1.38 | 3.11 | 3.00 | 3.18 | 3.50 |

**Flat, not monotonic.** Models over-use causal *so* at roughly 2.5x the human rate with or without
this skill. R2 does not cause it. The gate removes it.

### The corpus was 14.1% duplicated

`fetch_corpus.py` selected both an enclosing `<blockquote>`/`<li>`/`<td>` and the paragraphs nested
inside it, so the same words entered twice. Corpus 286,696 to **246,402 words** after the fix. The
GCP incident reports were about 49% duplicated, Paul Graham's essay 50%, the Wikipedia page 38%.

Every statistic in this repository was recomputed and republished: claim-first proxy 0.889 to
**0.898**, numbers per 100 words 1.334 to **1.152**, paragraph mean 84.4 to **76.5**, sentences over
30 words 21.7% to **21.9%**, mechanism:evaluative 3.14 to **3.30**. `verify_all.py` now checks every
republished number in SKILL.md against `corpus/measurements-train.json` on every run.

### The comprehension grader scored wrong answers correct

It matched numbers as an unordered set, so *"A gets 9.5 GB and B gets 19 GB"* scored correct against
a key saying the opposite, and *19 GiB* scored against *19 GB*. Word overlap could also override a
numeric disagreement. Now: numbers must appear in the key's order, any unit the key names must be
present, and the lexical path cannot fire when the key carries numbers. **52 item verdicts changed.
Every conclusion was recomputed post-regrade and all of them survived.**

### The installer's own safety check was defeated

`|| true` discarded the checker's exit status, so astra injected exit 2 into all ten exemplar runs
and still saw `gate ran on all 10 exemplars, 0 tier-1 hits  ok`. The status is now checked: 0 and 1
are expected, anything else is a crash, and a run producing no report fails too.

### Condition H is invalid, and the judge is what proved it

The blind pairwise judge ranked published prose by Brooker, Cloudflare and Gregg last in **24 of 24
pairs**. Its reasoning: *"Candidate A omits all timestamps"*, *"includes the brief's required future
work, which Candidate A omits entirely"*. H is an anchored span being asked to answer a brief whose
facts were drawn from the whole source document. Metric 2 shows the same at 13.1% of graded facts.
H is reported everywhere and excluded from every conclusion.

### Not fixed, and named

- Multiline heading patterns: the same heading passes or fails depending on position. Adding `re.M`
  alone over-fires on a genuine Rust heading, so it needs per-pattern work.
- Documented exceptions in `negative-set.md` are not implemented: upfront summaries, Markdown links
  and attributed inline quotations still take hard failures.
- Four regexes displayed in `negative-set.md` are truncated to 300 characters and do not compile as
  shown. All 68 runtime regexes in the JSON compile; the Markdown is documentation, not the spec.
- The 25-word paragraph floor still conditions every paragraph statistic, and is labelled rather than
  removed.
- voice.md's on-chip-capacity pair still asserts a regime change it does not derive, and the new
  route-lookup pair omits the offered load needed to reach its 5-second timeout.

### Still open

- **Metric 1** needs your 60 labels before its judge can gate anything; kappa is uncomputed.
- **Metric 3** has never been run. 50 documents are blind-staged at `eval/edits/edited/`.
- The mechanism and evaluative classifiers remain lexical and unvalidated against annotated text.
- The held-out independence claim stays withdrawn until a new, unexposed validation set exists.

---

## r2 -- 2026-09-18 -- six blockers from an independent review, all verified before acting

> **Superseded in part by r3.** The causal-*so* table below was produced by a detector with two
> defects, and its headline claim -- that the skill drives the rate up monotonically -- does not
> survive correction. Every number in this entry predates the corpus deduplication. Read r3 first.

`gpt-6-astra` at max effort reviewed the skill and returned **BLOCKERS: 6**. I re-derived every
checkable claim myself before changing anything, and **it was right on all of them**. Full review at
`reports/astra-round-1.md`.

### The one that matters most: a rule was manufacturing its own tic

Measured across the 160 generated eval outputs, causal *so* per 1000 words:

| | train corpus | held-out human | no skill | rules only | +exemplars | **full skill** |
|---|---|---|---|---|---|---|
| causal *so* | 0.80 | 1.14 | 2.66 | 2.92 | 3.14 | **3.46** |
| *instead of* | 0.36 | 0.24 | 0.41 | 0.99 | 0.80 | **1.29** |
| *rather than* | 0.19 | 0.06 | 2.17 | 0.69 | 1.09 | 0.54 |

R2 licenses *so* for causality, and the skill drives it monotonically to **4.3x the corpus rate**.
The per-sentence cap could never see this: a document with one causal *so* in every sentence passes
R2 cleanly. R3 works on its literal target -- *rather than* falls 4x -- and displaces the
construction into *instead of*, which rises 3.2x.

Both rules now carry the measurement, and `prose-check.py` reports all three rates against the
corpus and human figures.

### Instrument defects that were setting the rules

- **The sentence splitter required a capital after the boundary**, so *"Latency fell to 4 ms. p99
  stayed flat."* scored as one sentence. In a corpus full of p99, kubelet and `memory.swap.max` that
  is a systematic undercount. Fixing it moved every sentence-derived number.
- **`re.I` applied to the whole abbreviation pattern** made its lowercase-only lookahead match
  capitals, so *"etc. The"* was protected and never split; and `Ms` matched the unit `ms`.
- **`is_claim_first` is a lexical proxy and was presented as a measurement.** The review supplied
  counterexamples, and two of them are **voice.md's own "before" examples**: both bad openings pass
  the classifier that is supposed to detect them. The rule stands; the number is now labelled as
  survival of four exclusions, and the 0.742 minimum as an observed minimum rather than a floor.
- **A quoted question defeated the question check**: `"Why did every replica reject writes?"` with a
  closing quote scored as a claim.

### Numbers corrected

| claimed | actual |
|---|---|
| 167,000 words | **161,966** retained |
| PEP claim-first 0.92 | **0.93** |
| *Design Docs at Google* hedges highest in corpus | highest **family mean**; highest document is SRE's SLO chapter at 2.881 |
| mechanism:evaluative n=30 | **n=27** -- three GCP reports have zero evaluative sentences, so the ratio is undefined |
| danluu-postmortem-lessons 7.40, highest in corpus | highest among the **selected exemplars**; corpus max is 9.556 |
| 22.77% of sentences over 30 words | **21.67% document-weighted, 20.92% pooled** -- the estimand is now labelled everywhere |

### Technical errors in my own teaching examples

Five of voice.md's "after" examples were wrong, and one was worse than its "before":

- *"its p99 sets the floor for the p99 of every downstream call"* -- false. A 12 ms component can
  call a 1 ms dependency. Replaced with the serial-path budget claim, which is what was meant.
- **40 x 200 = 8,000, not 4,000.** Both before and after carried the contradiction. The pool now
  exhausts at instance 21, which is what the arithmetic says.
- 1/28 is the probability of drawing the *identical* pair, not the fraction degraded; any overlap
  occurs for 13/28.
- *"the only safe action is to give up"* without idempotency -- status queries and read-back exist.
- *"the exponent changes"* past on-chip capacity -- the operation count's exponent does not change;
  what sets runtime does.

Rule 5's third pair demonstrated qualification rather than length variation, and both of Rule 6's
pairs were bracketed instructions rather than prose. All three replaced with real pairs.

### Provenance: the held-out claim was too strong, and is withdrawn

**Nine negative-set patterns cite held-out documents in their exclusion rationales** -- Brooker,
KEP-2400, KEP-3521, Cloudflare and Gregg. The negative-set extraction agents had read access to the
whole corpus and used test-family text to decide what a pattern must *not* fire on. My firewall was
written into the eval-building workflow and not into that one.

What this does and does not affect: no evidence was found of score inflation or of exposure to the
frozen questions and answers, and the nine patterns resolve as five tier-2 and four tier-3, none of
them enforced. The stronger assurance that conservative exclusions *cannot* change scores is not
supportable and is withdrawn too -- they can change generation and revision behaviour. The claim
"rules were developed without touching held-out data" is false as stated and is withdrawn. Restoring
it requires a new, unexposed validation set.

### Other fixes

- `prose-check.py` **fails closed**: a missing or non-compiling pattern file used to disable every
  pattern check while still printing "FAIL none".
- `install_skill.sh` runs the gate on **all ten exemplars** and asserts zero tier-1 hits, instead of
  smoke-testing the one that passes.
- The brief no longer claims to be the sole container of every fact: it governs the argument, and
  source material remains the authority for supporting detail.
- Exemplar precedence narrowed -- they outrank the descriptive rules, not R1-R12, not correctness,
  and not house style, since five of the ten fail this skill's own gate.
- *"Fixing 4 of 7 sites is worse than fixing 0"* was an unsupported universal. Replaced with the
  actual obligation: sweep for every site first, and disclose what remains.

### Still open after r2

- Metric 1 needs your 60 labels. Metric 3 needs your edits. Both harnesses are built.
- The mechanism and evaluative classifiers are lexical and unvalidated against annotated text.
- The paragraph filter drops every block under 25 words, so "paragraphs average 84.4 words" is
  conditioned on that.

---

## r1 -- 2026-09-18 -- installed and usable

**Status: usable now, not validated.** No eval has run and no independent review has happened. The
rules below are measured; whether following them produces better documents is exactly what rounds 2
onward are for. Two of your original self-score axes were overridden on measurement, and if you
disagree with those calls this is the round to say so.

### Shape

| | before | after |
|---|---|---|
| SKILL.md | 1571 lines, ~35k tokens on every trigger | **211 lines** |
| references/ | 1 file, 219 lines | 7 files, 2,615 lines, loaded on demand |
| exemplars | none | 10, with their measured properties in the header |
| gate | a checker earlier reviews rejected | `prose-check.py`, tested against the corpus it came from |

All 1211 non-blank lines of the old SKILL.md have a destination; the 26 that do not are frontmatter,
the old table of contents, and two headers replaced by design. Nothing was paraphrased: the split
was done by verbatim slice.

### What moved where

- `references/learning-center.md` -- the learning-centre production spec: scope contract, renderer
  conflict, page shape, the 20-site margin survey, the 290-figure belonging census, the colour
  biconditional. Verbatim, and no longer loaded when you are writing anything else.
- `references/craft.md` -- metadiscourse, characters and actions, dash classification, headings,
  organisation, introducing a term, mechanism and boundary, caveat placement, kinds of intuition,
  register choice, sentence rhythm, the cold read, and the classic-style stance.
- `references/voice.md` -- new. Six rules, each with its measurement and three before/after pairs.
- `references/negative-set.md` -- new. 25 tier-1 patterns that fail, 43 tier-2 that flag.
- `references/owner-examples.md` -- unchanged.

### R1-R12 are unchanged

Owner law. They bind the edit and none of them was touched.

### Three self-score axes overridden, with the measurement

Measured over 30 documents from 9 public sources, 167,000 words. Full write-up in
`reports/phase2-measurements.md`.

| asked for | refused because | replaced with |
|---|---|---|
| no sentence over 30 words | 22.77% of the corpus exceeds it; **danluu runs 47.0%**, mean 33.2 | report sentences over 45 words for clause-resolution review. No cap |
| every claim numbered | numbers per 100 words is 1.334 with **sd 1.267**. AWS Builders' Library runs 0.32 and is excellent | a claim resting on a quantity carries it with unit and source. No density target |
| zero hedges | 1.383 per 100 words across the corpus; *Design Docs at Google* hedges hardest at 2.45 | hedge, qualify, or quantify. Delete the hedge protecting the writer, keep the one stating a bound |

### Two requested measurements could not be made

- **Words before the first concrete noun.** 17.73% of the corpus is outside the Brysbaert
  concreteness norms -- `gpu`, `throughput`, `kubelet`, `tensor` are all absent -- and the two
  defensible OOV treatments give 4.01 and 10.85 words. No threshold derived.
- **Hyphenated coinages per 100 words.** The rarity proxy returns 581 types including `all-hands`,
  `actor-critic` and `api-level`. Replaced by the closed tier-1 list.

### The rule that did survive cleanly

`claim_first_share` = **0.893, sd 0.062, n=29, range 0.758-1.000**. The tightest metric measured, and
it holds at 0.94 across Google Cloud incident reports and 0.92 across Python PEPs.

### Instrument defects found and fixed before they set a rule

- The sentence splitter consumed terminal punctuation, so a paragraph opening `Why does the cache
  miss?` reached the claim-first classifier without its question mark and counted as a claim.
- Python rejects variable-width lookbehind, so the first abbreviation guard was never a working regex.
- A failed two-column PDF extraction scored `claim_first_share` 1.000 on six 818-word blocks and
  carried a 135.7 sd into the corpus paragraph mean. Documents whose paragraph segmentation failed
  are now excluded from paragraph metrics and the exclusion count is reported.
- The negative set was tiered against 184,722 words of expert prose, not only hand-written negative
  examples. That demoted 5 of 30 tier-1 patterns, one firing 215 times across 15 documents.
- R2 counted bare `so`, catching "so far", "just so happens" and "so-called". Narrowed to causal `so`.
- R3's one-per-rendered-page budget was being applied per file, which fails every multi-page document
  measured. Now scored per ~1000 words, with the interpretation printed.

### Known gaps in this round

- **No eval has run.** Conditions A/B/C/D/H are built and the held-out set is frozen, but no numbers
  exist yet. Nothing here is evidence that the skill improves writing.
- **No independent review.** The astra round-1 prompt is written and unrun.
- **`status_update` has no exemplar** in either corpus split, so for that genre the rules run alone.
- Tier-2 patterns (43) are flagged, not enforced, and several are worth arguing about.
