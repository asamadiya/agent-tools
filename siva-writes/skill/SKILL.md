---
name: siva-writes
description: >
  Use when authoring or rewriting substantial technical prose: design docs, RFCs, postmortems,
  performance analyses, status updates, handbooks, chapters, and course pages. Use it whenever
  the user asks for a writeup, a design doc, an RFC, a postmortem, an incident report, a status
  update, or a technical explanation of any length, even if they do not name a format. Also use
  for "siva-writes", "rewrite this properly", "make this sound less like AI", "this reads like
  slop", or prose that "reads like AI wrote it". Applies to figure text, captions, aria-labels
  and headings, which are prose surfaces and are where style passes usually fail to look.
---

# siva-writes

Write about what a tensor, byte, GPU, request, or person does. Give the reader the fact, the
calculation, or the experiment. Name the topic in the heading.

The bar is a fellow or distinguished engineer at a large internet company: answer first, mechanism
over adjectives, every claim that rests on a quantity carrying that quantity, and nothing the
reader already knows.

**Work in three stages. Do not skip to stage 2.** The stages exist because writing and deciding
what to say are different jobs, and doing them in one pass produces prose that is fluent about
whatever the first sentence happened to commit to.

---

## Stage 1. The brief, under 150 words

Before any prose, write the brief. Four fields, nothing else:

| field | what goes in it |
|---|---|
| **Claim** | The one sentence the reader should be able to say out loud afterwards. |
| **Evidence** | The quantities that make it true, with units and where each came from. |
| **Mechanism** | Why it is true. Not that it is true. |
| **Decision** | What the reader should do, or what changes because of this. |

If the claim will not fit in one sentence, the document has two claims and needs to be two
documents or one with a stated order. If the evidence field is empty, say so in it -- a brief that
records *no measurement, the argument is structural* is honest and produces honest prose. If the
mechanism field restates the claim, you do not have a mechanism yet, and finding that out here
costs a line instead of a draft.

## Stage 2. Prose from the brief

Write from the brief. Not from the source material, not from what you happen to remember reading.
Anything that did not make the brief does not go in the document, and if that feels wrong, fix the
brief and write again.

**Load two exemplars before writing.** `references/exemplars/INDEX.json` maps the document type to
its two. Read them. **The exemplars outrank every rule in this file**: a rule is a compression of
what those documents do, and the compression loses. For `status_update` the index is empty, because
no public exemplar family exists for that genre in either corpus split -- there the rules run alone,
which is a weaker position and worth knowing you are in.

## Stage 3. The gate, then revise

Run `python3 scripts/prose-check.py <file>` and read the report. Fix what it finds, then read the
document yourself for the things no count detects.

---

## The owner rules

These bind the edit. They are editing requirements, not claims about what all good writers do.
Counts can detect a violated constraint; they cannot establish good style or human authorship.
The owner decides whether the writing works.

| Rule | Write this way | Check |
|---|---|---|
| **R1. Actor** | Put the relevant concrete actor or technical object in the subject: a tensor, byte, GPU, kernel, tokenizer, matrix, model, request, or **we**. | Replace abstract nouns acting as people and document-agents such as *the step argues / prices / recovers*. A technical term can be a legitimate subject. |
| **R2. Connection** | Use **so** for a causal consequence and **and** for a list or conjunction. At most **one so per sentence**. | Name the actual cause. Split a second consequence into a new sentence; changing a connector cannot establish causality. |
| **R3. Comparison** | Use **instead of** for a real comparison. State the positive fact without performing a contrast. At most **one rather than per rendered page**. | Count titles, summaries, cards, body and captions together. Keep logical negation needed for truth; *not invariant* can be essential. |
| **R4. Ending** | End a paragraph on a computed number or a full active sentence. | Remove aphoristic fragments such as *Two regimes, one machine.* Headings and UI labels have their own form. |
| **R5. Once** | Say the fact once. | Delete the sentence that explains the sentence just read. A second representation earns space by adding a calculation, boundary, or experiment. |
| **R6. Delivery** | Deliver the fact now, or link using the destination's content. | Replace *the physics track*, *the step gives it*, and promises of an argument with the result or a link such as *KV storage and the bandwidth roofline*. |
| **R7. Terms** | Keep standard technical terms and introduce them beside their definition or number. | *Arithmetic intensity: FLOP per byte* is useful. Coined labels that rename a known operation are not. |
| **R8. Experiment** | Use an imperative when the reader can test the claim: **Permute the rows. Hold the values fixed. Count the parameters.** | Replace a statement announcing an experiment with the experiment and its observable result. |
| **R9. Directness** | Name the actor and use an active verb. Remove scare quotes, filler, and *in this approach*. | Keep necessary uncertainty and conditions. Published quotations and technical string literals are not scare quotes. |
| **R10. Echo** | Read the last two sentences together. | Remove repeated words, conclusions, openings and connectors, including repeated *so*. Inspect *every*, *never* and *walks* for habitual rhythm. |
| **R11. Dash** | Write an ASCII spaced double hyphen, **` -- `**, when a prose dash is needed. | No prose U+2014, including examples. For a published quotation, preserve exact punctuation or explicitly label punctuation normalization. |
| **R12. Numbers** | Compute each number and state its units, assumptions and source when empirical. | Check what the calculation **proves**, including necessary versus sufficient conditions. A wrong number or false premise is a finding; repair dependent claims within scope and report the change. |

Worked applications of R1-R12, with the owner's own rewrites and the technical corrections to them,
are in `references/owner-examples.md`. Read it before applying the rules to unfamiliar material.

---

## The measured bar

Six rules from 30 documents across 9 public sources, 167,000 words. Full derivation, per-family
tables and three before/after pairs per rule: `references/voice.md`.

| # | rule | measured |
|---|---|---|
| 1 | **The first sentence of a paragraph is its claim** | 0.893, sd 0.062, n=29, range 0.758-1.000 |
| 2 | **Attach the number to the claim resting on it. No density target** | 1.334 per 100w, **sd 1.267** |
| 3 | **Mechanism outnumbers evaluation about 3 to 1** | 3.14, median 2.60; evaluative words 0.362 per 100w |
| 4 | **Hedge, qualify, or quantify. Hedging is not banned** | 1.383 hedges per 100w, range 0.415-2.881 |
| 5 | **Vary sentence length. There is no cap** | mean 23.9, within-doc sd 13.59, **22.8% over 30 words** |
| 6 | **Paragraphs about 85 words; long ones are a minority** | mean 84.4, 17.2% over 120 words |

Rule 1 is the strongest result in the corpus: the tightest spread of any metric, and it holds at
0.94 across Google Cloud incident reports and 0.92 across Python PEPs, two populations with nothing
else in common.

Rules 2, 4 and 5 are stated as prohibitions on over-correction, because that is the direction the
error runs. Number quotas, hedge bans and sentence caps are the easiest rules to enforce and the
corpus refutes all three:

- The AWS Builders' Library carries **0.32 numbers per 100 words** and is among the best systems
  writing in public. *Timeouts, retries and backoff with jitter* argues a mechanism, and a
  measurement there would be a measurement of one workload.
- *Design Docs at Google* hedges at **2.45 per 100 words**, the highest in the corpus. Hedging
  tracks how much the writer knows: an incident report states what happened, a design document
  argues about conditions nobody has observed.
- **danluu runs 47% of sentences over 30 words**, mean 33.2, and is easy to read, because each long
  sentence resolves clause by clause. A 30-word cap rejects him wholesale.

### Two things that were asked for and cannot be measured

**Words before the first concrete noun.** 17.73% of this corpus is outside the Brysbaert
concreteness norms -- *gpu*, *throughput*, *kubelet*, *tensor* are all absent -- and the two
defensible treatments of out-of-vocabulary tokens give 4.01 and 10.85 words, a factor of 2.7. The
strict reading claims 53.5% of sentences contain no concrete noun, which is false about this corpus.
No threshold is derived. R1 covers the intent and you check it by reading the subject.

**Hyphenated coinages per 100 words.** The only corpus-relative proxy for novelty was rarity, and it
returns 581 types including `all-hands`, `actor-critic` and `api-level`. Rarity in 30 documents is
not evidence of novelty. Replaced by the closed list in `references/negative-set.md`.

---

## The self-score gate

`scripts/prose-check.py` reports these. Three of them differ from what a reasonable person would
specify, and the reason is in the right-hand column.

| axis | threshold | why this and not the obvious one |
|---|---|---|
| **Takeaway in sentence one** | the document's first sentence states the claim from the brief | -- |
| **Claim-first paragraphs** | report the share; below 0.75 is outside the entire measured corpus | the corpus floor is 0.758, so 0.75 is a boundary, not a target. 0.893 is the mean, and forcing every paragraph to 1.000 produces a document with no connective tissue |
| **Quantified claims** | every claim resting on a quantity carries it with unit and source | **not** "every claim numbered". Numbers/100w has sd 1.267 against a mean of 1.334; there is no rate to hit. Unattributed numbers are the failure, not absent ones |
| **Long sentences** | report sentences over 45 words for clause-resolution review. **No cap, no failure number** | a 30-word cap fails 22.8% of the corpus and 47% of danluu. Length is not the defect; an unresolvable clause is |
| **Long paragraphs** | flag paragraphs carrying two distinct claims. 120 words is a look-here line, not a limit | 17.2% of measured paragraphs exceed 120 words. The defect is two claims in one paragraph, which the reader cannot attribute |
| **Negative-set patterns** | zero tier-1 patterns | 25 patterns, each firing **zero times across 184,722 words of expert human prose**. That control demoted 5 that passed hand-written negatives, one of which fired 215 times across 15 documents. Tier 2 (43) is flagged for a human read. See `references/negative-set.md` |
| **R11 dash** | zero prose U+2014 | quotations excepted and labelled |

A clean gate report is not approval. No automated pass detects a document that states its mechanism
and never states its purpose; five cold readers of one delivered lesson all reproduced its
derivations and none could say what the component was for. The instrument for that is in
`references/craft.md`, under the cold read.

---

## Rewriting an existing document

Learned expensively, and not optional.

- **Bounded regions only.** Replace a span you have read, anchored on a string you have verified is
  unique. Never regenerate a whole file. Three files were damaged in one session by ignoring this.
- **Your repairs are the next round's defects.** Review replacement text harder than the original.
  It was written faster, by someone who had just convinced themself they understood the problem.
- **Fixing 4 of 7 sites is worse than fixing 0**, because a document precise in one place and loose
  in another teaches the reader to distrust the precise one. Sweep for every site first.
- **Every surface carries the claim.** When a claim changes it changes in prose, caption, figure
  text, `aria-label`, any summary line and any derived instrument. Repairing one is not repairing
  the claim. A pass that certifies one surface has certified one surface.
- **Shortening a line to fix overflow eats the sentence.** After editing text that continues across
  runs or elements, join them and read the result.
- **Compute numbers; preserve attribution.** Record the original, the calculation, the corrected
  result and the affected claims. Do not change a quoted source to make it correct; correct outside
  the quotation.
- **Test the inference, not just the arithmetic.** A correctly multiplied product does not establish
  that each factor is near one. A calculation for random vectors does not describe learned vectors.
  An assumed peak rate gives a theoretical bound, not a measured regime.
- **A correction needs the evidence standard of the claim it corrects.** This corpus has taken a
  false measurement *from a correction*, which arrived with a plausible causal story. A wrong probe
  that explains itself is more dangerous than one that just returns a number.
- **Silence from a search is incapacity until proven otherwise.** Ledger extracts from PDFs keep
  ligatures and NUL bytes: `grep` without `-a` prints nothing and exits 1, and **`rg` walking the
  containing directory drops the file with exit 0 and no warning**. Put a term you know is present
  through the identical probe before believing a zero.

---

## Where everything else lives

| file | read it when |
|---|---|
| `references/voice.md` | you want the measurement behind a rule, or three before/after pairs for it |
| `references/exemplars/INDEX.json` | always, at stage 2 -- it names the two to load for your document type |
| `references/negative-set.md` | the gate flags a pattern, or you want the tier-1 list it enforces |
| `references/owner-examples.md` | applying R1-R12 to unfamiliar technical material |
| `references/craft.md` | metadiscourse, characters and actions, dash classification, headings, organisation, introducing a term, mechanism and boundary, caveat placement, kinds of intuition, register choice, sentence rhythm, the cold read, and the classic-style stance behind all of it |
| `references/learning-center.md` | **authoring or repairing anything in the learning-centre repo.** Scope contract, renderer conflict, page shape, margin-column survey, the 290-figure belonging census, and the colour biconditional. Does not apply to prose anywhere else |
| `references/reading-list.md` | picking something to study, tagged by which rule it demonstrates |

---

## What this skill does not do

It does not establish that a passage was written by a machine. No count here is an authorship
detector, and two earlier attempts to build one were withdrawn: an emphasis-density gate that fired
on the opposite of the defect it was built for, and a cross-document variance gate whose statistic
was mechanically length-dependent and whose incentive rewarded inconsistency. Treat "reads like AI
wrote it" as editing feedback and repair the named tell.

It does not certify that a document teaches anything. It does not certify arithmetic outside the
claims an edit touched. It is not owner approval.
