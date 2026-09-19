# results.md

All four metrics, per condition, with the status of each. Two of them need the owner and are
reported as not run rather than omitted.

## Conditions

| | what the writer was given |
|---|---|
| **A** | the brief only. No skill. |
| **B** | the owner rules and the measured bar. No exemplars, no staging, no gate. |
| **C** | B, plus the two exemplars matching the document type. |
| **D** | the full skill: C plus the brief-then-prose split and the self-score gate. |
| **H** | the human text. The anchored span of the source document the brief was derived from. |

Frozen eval: **40 briefs, 200 questions**, 32 with a human reference.
`prompts.jsonl` sha256 `68063c2be0f8ab78`, `questions.jsonl` `fe72dd750a77376b`.

---

## Metric 1: blind pairwise preference

**STATUS: PROXY, UNVALIDATED. Cohen's kappa against owner labels has not been computed. These win rates are descriptive and must not gate a Phase 5 change.**

Judge `gemini-3.8-flash`, a third model family: not the writer (Claude) and not the
reviewer (gpt-6-astra), and it has never seen the skill. Position shuffled with a recorded seed.

| condition | pairs | wins | win rate | Wilson 95% |
|---|---|---|---|---|
| C | 24 | 16.5 | 68.8% | [48.8, 83.6] |
| B | 24 | 16.0 | 66.7% | [46.7, 82.0] |
| D | 24 | 16.0 | 66.7% | [46.7, 82.0] |
| A | 24 | 9.5 | 39.6% | [22.8, 59.2] |
| H | 24 | 0.0 | 0.0% | [0.0, 13.8] |

**The judge failed its control, and that is the finding.** Condition H is published prose by
Marc Brooker, Cloudflare and Brendan Gregg. It lost **24 of 24 pairs, 0.0%**. A judge that
ranks expert human writing last, unanimously, is either broken or is measuring something
other than quality. Its own reasoning says which: *"Candidate A omits all timestamps"*,
*"includes the brief's required future work, which Candidate A omits entirely"*. It is
penalising H for not covering a brief H was never written to, because the briefs were derived
from an anchored span while their facts were drawn from the whole source document. The judge
is working. **Condition H is invalid in this design** and is excluded from every conclusion
in this file. Metric 2 shows the same defect independently: 13.1% of graded facts have
answers largely absent from the H span.

2 pairs returned no parseable verdict and are excluded.

**Cohen's kappa has NOT been computed.** No owner labels exist yet, so this judge is
unvalidated and its win rates must not gate a Phase 5 change. At n=60 the Wilson interval
is roughly +/-12 points on its own, before any question of whether the judge agrees with
the owner. Run `python3 tools/pairwise.py kappa <owner-labels.json>` after labelling
`eval/label-pairs.html`.

---

## Metric 2: comprehension

Reader `gemini-3.5-flash`: a weaker model from a different family than the writer, shown
the candidate write-up and the questions, never the brief.

| condition | documents | items | correct | accuracy | Wilson 95% | adjudicated |
|---|---|---|---|---|---|---|
| C | 40 | 200 | 152 | **76.0%** | [69.6, 81.4] | 70 |
| A | 40 | 200 | 140 | **70.0%** | [63.3, 75.9] | 73 |
| D | 40 | 200 | 136 | **68.0%** | [61.2, 74.1] | 68 |
| B | 40 | 200 | 126 | **63.0%** | [56.1, 69.4] | 65 |
| H | 32 | 160 | 80 | **50.0%** | [42.3, 57.7] | 54 |

### Paired, per brief

Every condition wrote from the same 40 briefs, so the paired comparison is the correct test
and is far more powerful than treating the conditions as independent samples.

| comparison | n | mean diff /5 | 95% CI | W-L-T | verdict |
|---|---|---|---|---|---|
| C vs D | 40 | +0.400 | [+0.180, +0.620] | 17-3-20 | **C higher** |
| C vs B | 40 | +0.650 | [+0.187, +1.113] | 16-5-19 | **C higher** |
| C vs A | 40 | +0.300 | [-0.177, +0.777] | 14-11-15 | not distinguishable |
| D vs A | 40 | -0.100 | [-0.575, +0.375] | 8-14-18 | not distinguishable |
| B vs A | 40 | -0.350 | [-0.918, +0.218] | 10-18-12 | not distinguishable |
| D vs H | 32 | +0.719 | [+0.175, +1.263] | 16-9-7 | **D higher** |
| C vs H | 32 | +1.125 | [+0.550, +1.700] | 19-5-8 | **C higher** |
| A vs H | 32 | +0.969 | [+0.262, +1.675] | 19-9-4 | **A higher** |

**H is deflated and its comparisons should not be used.** 13.1% of graded facts have answers
largely absent from the H span: the briefs' facts were extracted from full source documents
while H is only the anchored excerpt. H is reported for completeness and excluded from any
conclusion. The C-vs-D comparison is unaffected, since both write from the same brief.

---

## Metric 3: expert edit distance

**STATUS: NOT RUN.** This is the metric that says whether the skill saves the owner time or
only moves the tells somewhere he has stopped noticing, and it cannot be produced without him.

50 documents are staged under opaque ids at `eval/edits/edited/`, 10 briefs across 5
conditions, with the condition mapping deliberately not printed. Edit them in vim to the
standard you would publish, then:

```
python3 tools/edit_distance.py score
python3 tools/edit_distance.py classify
```

Classification uses the LAMP taxonomy from arXiv 2409.14509 section 4.4, read from the paper:
Cliche, Unnecessary/Redundant Exposition, Purple Prose, Poor Sentence Structure, Lack of
Specificity and Detail, Awkward Word Choice and Phrasing, Tense Inconsistency. The labels are
proposed by a model and marked PROPOSED, because only the person who made an edit knows why.

---

## Metric 4: over-represented n-gram ratio

Reported two ways, and **only the second is a style measurement**.

Surface n-grams rank the real human documents as MOST over-represented because their top trigrams are iostat column headers. Surface mode measures subject matter. Read the stylometric column.

| condition | documents | surface % | **stylometric %** |
|---|---|---|---|
| H | 32 | 4.8445 | **0.3566** |
| B | 40 | 2.6727 | **1.8580** |
| C | 40 | 3.4200 | **1.8796** |
| A | 40 | 2.9688 | **1.9458** |
| D | 40 | 3.8833 | **2.7178** |

Lower is closer to the train corpus of expert human writing. The stylometric column maps every
content word to one placeholder and keeps function words, so what is compared is syntactic
rhythm rather than subject matter. That the human condition is lowest by 5x under stylometric
scoring, and highest under surface scoring, is the evidence that the surface number was
measuring topic.

---

## Construction rates: the rules measured against their own effect

Per 1000 words. These are not one of the four metrics; they were added after Metric 4's
stylometric trigrams pointed at them.

| construction | TRAIN | r1 A | r1 B | r1 C | r1 D | r1 H | r2 B | r2 C | r2 D |
|---|---|---|---|---|---|---|---|---|---|
| causal so (R2) | 0.80 | 2.66 | 2.91 | 3.14 | 3.46 | 1.14 | 2.95 | 3.68 | 1.04 |
| all so | 1.81 | 4.62 | 3.73 | 4.27 | 4.42 | 2.81 | 3.67 | 4.93 | 1.54 |
| instead of (R3) | 0.36 | 0.41 | 0.99 | 0.79 | 1.29 | 0.24 | 0.94 | 0.79 | 0.96 |
| rather than (R3) | 0.19 | 2.17 | 0.69 | 1.09 | 0.54 | 0.06 | 0.85 | 1.63 | 0.63 |
| em dash (R11) | 0.28 | 4.95 | 0.00 | 0.00 | 0.00 | 0.24 | 0.00 | 0.00 | 0.00 |
| hedges | 1.66 | 1.51 | 1.41 | 1.30 | 0.92 | 0.66 | 1.20 | 1.51 | 1.17 |

---

## Phase 5: one change, re-run

The r2 change: R2 and R3 now carry their measured effect in the rule text, and the gate
reports causal-*so*, *instead of* and *rather than* rates against the corpus and human
figures. Same frozen briefs, same everything else. Condition A has no skill and was not
regenerated.

| condition | r1 accuracy | r2 accuracy | paired diff /5 | 95% CI | verdict |
|---|---|---|---|---|---|
| B | 63.0% | 75.5% | +0.625 | [+0.116, +1.134] | **moved beyond CI** |
| C | 76.0% | 71.0% | -0.250 | [-0.570, +0.070] | not beyond CI |
| D | 68.0% | 61.0% | -0.350 | [-0.768, +0.068] | not beyond CI |

| condition | r1 stylometric % | r2 stylometric % |
|---|---|---|
| B | 1.8580 | 2.2948 |
| C | 1.8796 | 1.9996 |
| D | 2.7178 | 2.3957 |

**C beats D in both rounds.** Paired, per brief: r1 +0.400 [0.180, 0.620] and r2 +0.500
[0.073, 0.927]. The result replicates on a second independent generation, which is the
strongest evidence in this evaluation.

