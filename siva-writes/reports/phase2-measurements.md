# Phase 2: what the corpus actually measures

30 documents, 9 train families, 167,000 words of prose after chrome exclusion. Every number
below is reproducible with `python3 tools/measure.py --splits train`. Test families were not
read or measured; they stay sealed until the eval runs.

The headline is that three of the axes the brief proposed as self-score gates are refuted by
the corpus the skill is being distilled from, and two of the seven requested measurements
cannot be made with the instrument available. Both of those are worth more than the rules that
did survive, so they come first.

---

## 1. Refuted: "no sentence over 30 words"

| family | sentence mean | within-doc sd | share over 30 words |
|---|---|---|---|
| aws-builders | 18.99 | 8.31 | **9.1%** |
| gcp-incident | 19.99 | 13.41 | 8.9% |
| rust-rfc | 20.81 | 10.16 | 12.3% |
| pep | 21.24 | 10.74 | 18.9% |
| sre-book | 21.45 | 9.73 | 16.2% |
| industrialempathy | 22.32 | 10.46 | 14.4% |
| allthingsdistributed | 23.18 | 11.52 | 24.0% |
| tail-at-scale | 25.71 | 15.40 | 31.9% |
| **danluu** | **33.18** | **22.70** | **47.0%** |

Corpus mean 23.92 words, sd 6.26. Across all 30 documents the share of sentences over 30 words
runs 0.69% to 55.62%.

A 30-word cap would reject 47% of Dan Luu's sentences and 55.62% of `danluu-pl-tokens`. It would
also reject roughly a fifth of the Tail at Scale and a quarter of Werner Vogels. The cap does not
describe the corpus; it describes one register within it.

What the corpus does support is **variance**: mean within-document sentence-length sd is 13.59,
and the lowest is 6.23. Expert prose alternates a 9-word sentence against a 35-word one. A cap
flattens exactly the variation that is doing the work, so the rule becomes: vary length
deliberately, put the load-bearing claim in a short sentence, and check any sentence over 45
words for whether the reader can resolve each clause -- with no failure number attached.

## 2. Refuted: "zero hedges"

Hedges per 100 words, corpus mean **1.383**, sd 0.692, range 0.415 to 2.881.

| family | hedges / 100w |
|---|---|
| industrialempathy | 2.45 |
| danluu | 2.05 |
| sre-book | 1.76 |
| rust-rfc | 1.30 |
| aws-builders | 1.25 |
| allthingsdistributed | 1.02 |
| pep | 0.94 |
| gcp-incident | 0.64 |

The document that most explicitly teaches engineers how to write design docs hedges the most.
That is not a defect in it. Hedging tracks how much the writer actually knows: an incident report
states what happened, and a design document argues about what will happen under conditions nobody
has observed yet.

The usable rule is Pinker's, not a rate: **hedge, qualify, or quantify**. Delete the hedge that
protects the writer; keep the one that states a bound. The test is what becomes false if the word
is removed.

## 3. Refuted: "every claim quantified" as a uniform rate

Numbers per 100 words, corpus mean 1.334, sd **1.267** -- a coefficient of variation near 1.0,
which means there is no corpus-level rate at all.

| family | numbers / 100w |
|---|---|
| gcp-incident | 3.90 |
| tail-at-scale | 3.18 |
| pep | 1.28 |
| danluu | 1.07 |
| rust-rfc | 1.06 |
| allthingsdistributed | 0.99 |
| sre-book | 0.67 |
| aws-builders | **0.32** |
| industrialempathy | 0.28 |

The AWS Builders' Library is among the best systems writing in public and carries one number per
312 words. Timeouts, retries and backoff is an argument about mechanism; the mechanism is what
transfers, and a number would be a number about one workload.

The rule that survives is about attachment, not density: **a claim that rests on a quantity states
that quantity with its unit and where it came from.** A claim about a mechanism does not acquire
one by decoration. The failure mode this rule exists to stop is the unattributed number, not the
absent one.

---

## 4. Not measurable: words before the first concrete noun

Requested in the brief. The instrument is the Brysbaert concreteness norms (39,954 words, with a
dominant-POS column). On this corpus **17.73% of tokens are outside that lexicon** (range 12.47%
to 28.26%), because it covers general English and this corpus is about GPUs, kubelets, tensors
and throughput -- all absent.

That forces a choice about out-of-vocabulary tokens, and the two defensible choices do not agree:

| OOV treatment | mean words before first concrete noun |
|---|---|
| OOV counted as concrete (a domain noun is a thing) | **4.01** |
| OOV counted as not-concrete (strict lexicon) | **10.85** |

A factor of 2.7. Per document the gap reaches 11.7 words (`danluu-metrics-analytics`: 4.62 against
16.33). Under the strict reading, **53.5% of all sentences contain no concrete noun at all**, which
is false about this corpus as anyone can see by reading it -- it is a statement about lexicon
coverage wearing a measurement's clothes.

**This measurement is not reported as a rule and no threshold is derived from it.** Making it work
would need a domain concreteness lexicon that does not exist. The underlying instruction -- put a
thing in the subject -- survives as the actor rule, which is checkable by reading the subject.

## 5. Not measurable: hyphenated coinages per 100 words

Requested in the brief. "Coinage" is not a property of a token in isolation: `context-window` and
`open-source` are standard, `thought-shaped` and `intelligence-forward` are not. The only
corpus-relative proxy available was rarity -- a hyphenated compound appearing at most twice across
all 30 documents.

It does not work. The detector returns **581 types**, and its output includes `all-hands`,
`actor-critic`, `always-on`, `api-level`, `acid-based`, and one entry that is an entire paper title
with the spaces replaced by hyphens. Measured rate 0.426 per 100 words, but the rate is measuring
rarity of legitimate technical compounds, not coinage.

Rarity in a 30-document corpus is simply not evidence of novelty. The replacement is to check the
specific compounds the negative set names as tells, which is a closed list a script can run, rather
than a rate over an open class. That list is `references/negative-set.md`.

---

## 6. What did survive, with its numbers

| rule | measured basis | n | spread |
|---|---|---|---|
| **Open a paragraph with its claim** | claim_first_share **0.893** | 29 | sd 0.062, range 0.758-1.000 |
| **Mechanism outnumbers evaluation** | mechanism:evaluative **3.14**, median 2.60 | 30 | range 0.33-9.56 |
| **Evaluative vocabulary stays rare** | evaluative words **0.362** / 100w | 30 | sd 0.262, max 1.283 |
| **Paragraphs run about 85 words** | paragraph mean **84.4** | 29 | sd 21.8, range 46.7-131.4 |
| **Long paragraphs are a minority, not absent** | **17.2%** of paragraphs over 120 words | 29 | sd 12.0, range 0-45.5 |
| **Sentence length varies within a document** | within-doc sentence sd **13.59** | 30 | min 6.23 |

Claim-first is the strongest result in the set: sd 0.062 on a mean of 0.893, the tightest of any
metric measured, and it holds across every genre from Kubernetes RFCs to incident reports. It is
the one number here that behaves like a property of the register rather than of an author.

The classifier behind it is operational and can be attacked: a paragraph is claim-first when its
first sentence is declarative, at least five words, does not open with a discourse connective
(however, but, moreover, for example, first, finally, in summary, ...) and does not take the
document as its subject (this section, in this post, we will discuss, ...). Two of the six
documents scoring below 0.80 do so because they open paragraphs with `However` and `But`, which is
a real stylistic choice and not an error -- the metric counts it, it does not judge it.

## 7. Instrument defects found and fixed

Recorded because each one would have put a false number into the rules.

- **The sentence splitter ate terminal punctuation.** `SENT_SPLIT.split()` consumed the `.` or `?`
  at the boundary, so a paragraph opening `Why does the cache miss?` arrived at the claim-first
  classifier as `Why does the cache miss` -- no question mark, classified as a claim. Fixed by
  slicing at the boundary and reattaching the terminator. Self-test now covers it.
- **Python rejects variable-width lookbehind**, so the first abbreviation guard was not a working
  regex at all. Replaced with protect-substitute-restore over a named abbreviation list, decimals
  and single-letter initials. Verified on `3.35 TB/s`, `Fig. 4`, `i.e.`, `J. R. R.` and `p99.9`.
- **A failed PDF extraction was setting a rule.** The Tail at Scale extracts as six 818-word blocks
  with no paragraph breaks, scored `claim_first_share` 1.000 and `paragraphs_over_120w` 100%, and
  carried a 135.7 sd into the corpus paragraph mean. Documents whose mean paragraph exceeds 300
  words are now flagged and excluded from paragraph metrics only; their sentence and token metrics
  are unaffected and retained. One document is currently excluded and the count is reported beside
  every paragraph-level aggregate.

## 8. Coverage this report does not have

- Test families (kep, brooker, cloudflare-pm, brendangregg) were not measured. Their numbers exist
  only after the eval runs, and comparing train to test is a separate question from the four metrics.
- The corpus is 30 documents from 9 sources. Family means over 1 to 7 documents are reported to
  three decimals by the script, which is more precision than 1 document supports; read the spread
  column, not the digit.
- `danluu` supplies 7 of 30 documents and is the outlier on three metrics. It moves the corpus mean.
  Its influence is visible in every table above by design rather than removed.
- Nothing here measures whether a document teaches anything. No count in this file detects a page
  that states its mechanism and never states its purpose.
