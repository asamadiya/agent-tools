# Writing rules

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