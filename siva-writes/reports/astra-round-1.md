<!-- model: gpt-6-astra  effort: max  context: long_context  session: 6914f0f2-3701-4573-8ba2-493993b07da0 -->
<!-- prompt: reports/astra-prompt-round1.md -->

Using writing-skills to audit the instructions, siva-writes for the review’s prose, and parallel
agents for the independent measurement and gate checks. This is a read-only review; I’ll reproduce
the numbers and failures rather than infer them from the write-up.

The most serious defect is that current negative-pattern rules incorporate supposedly held-out
source material. Freezing the evaluation questions does not establish family-held-out rule
development when held-out examples subsequently determine regex exclusions. Separately, the
load-bearing claim-first statistic does not measure what its name implies, and the gate rejects 5 of
the 10 human exemplars.

1. Wrong: the held-out provenance claim does not survive inspection

Files: skill/references/negative-set.json:929–1090; reports/phase2-measurements.md:4–5;
tools/merge_negative_set.py:60–94.

Current detection_note fields explicitly attribute exclusions to held-out families:

┌─────────────────────────┬────────────────────────────────────────────────────────────────────┐
│ Current pattern         │ Recorded influence                                                 │
├─────────────────────────┼────────────────────────────────────────────────────────────────────┤
│ wonder-adverb, JSON:955 │ Excludes “delightful” because Brooker uses it correctly; claims a  │
│                         │ check across 50 engineering documents.                             │
├─────────────────────────┼────────────────────────────────────────────────────────────────────┤
│ overfamiliar-address,   │ Excludes legitimate constructions from KEP-2400 and Gregg.         │
│ JSON:1036               │                                                                    │
├─────────────────────────┼────────────────────────────────────────────────────────────────────┤
│ decorative-emoji,       │ Excludes checkmark/cross glyphs because KEP-3521 uses them in a    │
│ JSON:1062               │ compatibility table.                                               │
├─────────────────────────┼────────────────────────────────────────────────────────────────────┤
│ magic-as-explanation,   │ Excludes bare “magic” partly because Cloudflare uses the product   │
│ JSON:1090               │ name Magic Transit.                                                │
└─────────────────────────┴────────────────────────────────────────────────────────────────────┘

These are current tier-2 patterns, not discarded proposals. Source-derived negative examples also
remain in the pool used to test other patterns. The distinctive examples were corroborated in seven
held-out documents.

The present merger’s corpus control is train-only. That does not undo earlier use of test-family
examples to construct the patterns.

Limit: this establishes recorded, operative rule-development dependence on held-out material. It
does not establish access to frozen comprehension questions or answers, measured overfitting, or
independently prove the historical full-50-document scan.

Make it right: reconcile the provenance and withdraw the strict family-held-out claim, or obtain
fresh, unexposed families for that validation claim. The existing frozen evaluation can remain
useful; it cannot support a stronger independence claim than its provenance allows.

2. Wrong: “claim-first” measures blacklist survival, not paragraph organization

Files: tools/measure.py:91–107,158–167; skill/references/voice.md:21–59; skill/SKILL.md:143.

is_claim_first does not establish that a sentence is declarative, contains a substantive claim, or
states the claim developed by the paragraph. It returns True after four exclusions.

Executed counterexamples:

┌────────────────────────────────────────────────────────┬─────────┬───────────────────────────┐
│ Opening                                                │ Result  │ Problem                   │
├────────────────────────────────────────────────────────┼─────────┼───────────────────────────┤
│ “Before discussing the retry policy, it is worth       │ True    │ This is Rule 1’s own bad  │
│ considering how the system behaves under partial       │         │ windup.                   │
│ failure.”                                              │         │                           │
├────────────────────────────────────────────────────────┼─────────┼───────────────────────────┤
│ “There are a number of factors that influence cache    │ True    │ This is its second bad    │
│ hit rate in this workload.”                            │         │ opening.                  │
├────────────────────────────────────────────────────────┼─────────┼───────────────────────────┤
│ “However, the production request queue is unbounded.”  │ False   │ A clear claim with a      │
│                                                        │         │ useful connective.        │
├────────────────────────────────────────────────────────┼─────────┼───────────────────────────┤
│ “Cache entries never expire.”                          │ False   │ A clear four-word claim.  │
├────────────────────────────────────────────────────────┼─────────┼───────────────────────────┤
│ "Why did every replica reject writes?"                 │ True    │ The closing quotation     │
│                                                        │         │ mark defeats              │
│                                                        │         │ endswith("?").            │
└────────────────────────────────────────────────────────┴─────────┴───────────────────────────┘

Thus two of the three teaching counterexamples already pass the supposed measurement of the defect.

The arithmetic behind 0.893, sd 0.062, n=29 reproduces. Its interpretation does not. The minimum is
47/62 paragraphs in danluu-metrics-analytics, which contains question-led sections. The six lowest
scores are 0.758, 0.784, 0.800, 0.820, 0.824, 0.829. Only two, not six, are below 0.80; the report’s
claim at lines 152–154 is wrong.

0.758 is an observed minimum of this filtered proxy, not an established floor for good prose. The
eligible documents represent eight families after excluding the sole Tail-at-Scale document. Neither
the small spread nor the minimum establishes a property of the register.

The mechanism rule has the same construct-validity problem. At measure.py:218–223:

 - “Since Monday…” counts as mechanism.
 - “The key is hashed to select a shard” counts as evaluative because of key.
 - Adding “in 2026” to “This architecture is a robust choice” removes it from the
evaluative-sentence count.

Moreover, SKILL Rule 3’s general prescription is contradicted by its own observations:
mechanism:evaluation is 0.333 for atd-10-lessons-10-years-aws and 0.600 for
atd-eventually-consistent. A mean of 3.14 does not establish a three-to-one writing requirement.

Make it right: validate these classifications against independently annotated paragraphs and
sentences before deriving editorial boundaries. Until then, name them as lexical proxies and remove
the semantic floor and ratio prescription.

3. Wrong: preprocessing changes the quantities being interpreted

Files: tools/measure.py:38,46–54,122–148,202–207.

The sentence splitter is not correct for ordinary technical prose. These each return one sentence:

 Latency fell to 4 ms. p99 stayed flat.
 We checked logs, traces, etc. The queue was full.
 The service runs in the U.S. It handles writes.
 The disk filled.” All writes failed.

It misses boundaries before lowercase identifiers, numbers and backticks; protects some
sentence-final abbreviations and initials; and mishandles typographic closing quotes. These defects
affect sentence lengths and can turn a question followed by another sentence into a positive
claim-first classification.

The paragraph filter is also doing more than chrome removal. It drops every block below 25
alphabetic words, including substantive short paragraphs. Conversely, long metadata and code can
survive. The gate reports PEP 572’s author/title metadata as its “opening sentence.”

Consequently, “paragraphs average 84.4 words” means retained blocks already conditioned on having at
least 25 words, not unrestricted expert paragraphs.

The 300-word reliability guard is an unvalidated alarm threshold, not a segmentation-quality test.
Excluding the visibly damaged PDF is reasonable; generalizing that exclusion into a reliability
classifier is not. I merged every two retained paragraphs of the AWS timeouts document:

 - Mean paragraph length changed from 80.321 to 160.643.
 - Claim-first changed from 0.893 to 0.857.
 - paragraph_segmentation_reliable remained True.

Make it right: distinguish prose, headings, code and metadata structurally; test sentence boundaries
on annotated technical text; inspect suspicious extractions rather than certify everything below
300 words. Then regenerate the measurements. Simply choosing a different cutoff would not fix this.

4. Wrong: the gate fails its required human controls and has inconsistent scope

File: skill/scripts/prose-check.py:108–150.

I independently ran the actual CLI separately on all ten unchanged exemplars. These five exit 1:

┌───────────────────────────────────────────────┬───────────────────────────────────────────┐
│ Exemplar under skill/references/exemplars/    │ Hard failure                              │
├───────────────────────────────────────────────┼───────────────────────────────────────────┤
│ aws-workload-isolation-shuffle-sharding.txt   │ R11: 2 em dashes                          │
├───────────────────────────────────────────────┼───────────────────────────────────────────┤
│ danluu-perf-opt.txt                           │ R2: 1 sentence with multiple causal sos   │
├───────────────────────────────────────────────┼───────────────────────────────────────────┤
│ pep-0572-assignment-expressions.txt           │ R3: 6 occurrences against a budget of 4   │
├───────────────────────────────────────────────┼───────────────────────────────────────────┤
│ sre-book-ch03-embracing-risk.txt              │ R11: 7 em dashes                          │
├───────────────────────────────────────────────┼───────────────────────────────────────────┤
│ sre-book-ch15-postmortem-culture.txt          │ R11: 1 em dash                            │
└───────────────────────────────────────────────┴───────────────────────────────────────────┘

Clean controls: AWS timeouts, Dan Luu latency-pitfalls, Dan Luu postmortem-lessons, the GCP
incident, and Rust RFC 2229 passed. No tier-1 pattern matched any exemplar.

The Dan Luu failure really contains two causal connectors; that failure is not merely a tokenization
mistake. The policy itself conflicts with the expert-control acceptance criterion. The installation
smoke test checks only the passing AWS timeouts exemplar (tools/install_skill.sh:49–54).

There are additional executable defects:

 - Inconsistent prose extraction. A short paragraph containing two causal sos disappears from R2;
code can trigger R2/R3; attributed inline quotations fail R11 while arbitrary Markdown blockquotes
are exempt. R3’s round(words/1000) budget is not a rendered-page count.
 - Missing regex flags. The gate and merger compile with re.I, while heading patterns require
multiline behavior (prose-check.py:131,208; negative-set.md:324,407). An emoji heading fails at
document start but passes after a paragraph. Adding re.M alone is not safe: tier-1
decorative-heading then rejects the genuine, outside-code Rust heading ## How We Teach This.
 - Documented exceptions are not implemented. A factual opening “In summary, the measured p99 fell…”
fails in-conclusion-restate, although the documentation permits upfront summaries. [Insert into a
table](sql-insert.html) fails unfilled-placeholder, despite the documented link exclusion.
 - Configuration fails open. Missing pattern JSON silently disables the pattern checks; an invalid
tier-1 regex merely produces a report (prose-check.py:71–75,130–134).
 - The Markdown is not an executable specification. Five displayed regexes are truncated to 300
characters; four no longer compile (negative-set.md:71,228,245,295,376). The JSON versions are
intact.

The self-score table also mixes automatic observations with unperformed semantic checks. Units,
attribution, arithmetic, governing claims and two-claim paragraphs are not verified. Optional brief
matching is lexical: Enable versus Disable the cache can still score 0.86 overlap.

Make it right: separate explicit house-style enforcement from expert-prose validation; use
consistent format-aware extraction; implement or demote contextual patterns; fail explicitly when
checks cannot load; and mark human checks not assessed until reviewed. Run all ten controls, not
one.

I would not add more hard thresholds merely to make the gate say no. It already says no to half its
expert examples.

5. Wrong: several “after” examples teach technical errors

File: skill/references/voice.md.

┌─────────┬───────────────────────────────────────┬────────────────────────────────────────────┐
│ Lines   │ Defect                                │ What would make it right                   │
├─────────┼───────────────────────────────────────┼────────────────────────────────────────────┤
│ 133–134 │ A component’s p99 does not establish  │ Discuss the enclosing request’s latency,   │
│         │ a floor for every downstream call’s   │ over the same request population, under an │
│         │ p99. A 12 ms component can invoke a 1 │ explicit serial-dependency assumption.     │
│         │ ms downstream operation.              │                                            │
├─────────┼───────────────────────────────────────┼────────────────────────────────────────────┤
│ 223–228 │ 40 × 200 = 8,000, not 4,000. With     │ Correct the premises and recompute the     │
│         │ fully allocated 200-connection pools, │ exhaustion point; do not preserve the      │
│         │ 4,000 supports 20 instances, not 40.  │ contradiction while shortening it.         │
│         │ Both before and after are wrong.      │                                            │
├─────────┼───────────────────────────────────────┼────────────────────────────────────────────┤
│ 124–127 │ 1/28 is the probability of an         │ Restore the exemplar’s missing condition:  │
│         │ identical unordered pair, not         │ clients must survive one failed worker by  │
│         │ automatically the fraction suffering  │ using the other, with adequate capacity.   │
│         │ any degradation. Any overlap occurs   │ Say “lose both alternatives,” not generic  │
│         │ for 13/28 pairs.                      │ “degrades.”                                │
├─────────┼───────────────────────────────────────┼────────────────────────────────────────────┤
│ 140–142 │ Without idempotency, “the only safe   │ State the narrower condition: retrying     │
│         │ action is to give up” is false in     │ risks duplication when neither idempotency │
│         │ general. Status queries, read-back    │ nor outcome verification is available.     │
│         │ and reconciliation protocols can      │                                            │
│         │ provide alternatives.                 │                                            │
├─────────┼───────────────────────────────────────┼────────────────────────────────────────────┤
│ 180–183 │ Crossing an on-chip-capacity boundary │ Name the operation and distinguish         │
│         │ does not by itself establish that     │ operation count, memory traffic and        │
│         │ “the exponent changes.” Neither the   │ runtime; derive the claimed regime change. │
│         │ operation nor the cost being measured │                                            │
│         │ is specified.                         │                                            │
└─────────┴───────────────────────────────────────┴────────────────────────────────────────────┘

The p99 rewrite is worse than its before: it replaces an uninformative evaluation with a false
inference.

There are also demonstration mismatches. Rule 5’s mask example at lines 232–234 explains
qualification and mechanism, not sentence-length variation. Rule 6’s first and third pairs are
bracketed rewrite instructions, not actual before/after paragraphs.

Clean checks: I read all 18 pairs. The encoder’s 19.2/10.1 ≈ 1.9×, the 12/30 = 40% arithmetic, and
the fixed-mask/noncommutation explanation are sound. The p99 inference remains wrong despite its
correct percentage.

6. Wrong: several published numbers, rankings and denominators are misstated

All 30 stored per-document rows reproduced exactly from the current instrument and training texts.
That establishes reproducibility, not validity. The following narrative claims nevertheless disagree
with those rows:

┌──────────────────────────────────┬───────────────────────────────────────────────────────────┐
│ Claim and location               │ Recomputed result                                         │
├──────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ 167,000 words, SKILL.md:92,      │ 161,966 retained words under this instrument.             │
│ report:3                         │                                                           │
├──────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ PEP claim-first 0.92,            │ 0.9373, rounding to 0.94.                                 │
│ SKILL.md:105, voice:26           │                                                           │
├──────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Design Docs at Google hedges     │ Its 2.448 is below SRE’s Service Level Objectives: 2.881, │
│ “highest in the corpus,”         │ among others. It is the highest family mean, not document │
│ SKILL.md:115                     │ value.                                                    │
├──────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Mechanism:evaluation n=30,       │ n=27. Three GCP documents have zero evaluative sentences  │
│ voice:112, report:139            │ and undefined ratios, so they are excluded.               │
├──────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ Postmortem-lessons 7.40, highest │ Maximum is 9.556, danluu-p95-latency. 7.40 is highest     │
│ in corpus, INDEX.json:42         │ among the selected exemplars.                             │
├──────────────────────────────────┼───────────────────────────────────────────────────────────┤
│ A 30-word cap rejects “roughly a │ The current instrument reports 31.94%, approximately a    │
│ fifth” of Tail at Scale,         │ third.                                                    │
│ report:32, voice:203             │                                                           │
└──────────────────────────────────┴───────────────────────────────────────────────────────────┘

Several percentages are means of document percentages, presented as fractions of the whole corpus:

┌───────────────────────────────────────────────┬────────────────────┬─────────────────────────┐
│ Quantity                                      │ Document-mean      │ Pooled figure           │
│                                               │ figure             │                         │
├───────────────────────────────────────────────┼────────────────────┼─────────────────────────┤
│ Sentences over 30 words                       │ 22.765%            │ 1,505/6,862 = 21.932%   │
├───────────────────────────────────────────────┼────────────────────┼─────────────────────────┤
│ Dan Luu sentences over 30 words               │ 47.041%            │ 49.517%                 │
├───────────────────────────────────────────────┼────────────────────┼─────────────────────────┤
│ Eligible paragraphs over 120 words            │ 17.232%            │ 307/1,953 = 15.719%     │
├───────────────────────────────────────────────┼────────────────────┼─────────────────────────┤
│ Lexicon OOV tokens                            │ 17.726%            │ 18.276%                 │
├───────────────────────────────────────────────┼────────────────────┼─────────────────────────┤
│ Sentences without a strict concrete-noun      │ 53.456%            │ 51.545%                 │
│ match                                         │                    │                         │
└───────────────────────────────────────────────┴────────────────────┴─────────────────────────┘

Equal-document weighting is defensible. Calling its result “22.77% of all sentences” is not. Label
the estimand and weighting, rather than silently substituting one statistic for another.

Clean numerical coverage: the six measured-bar rows otherwise reproduce as document-level summaries,
including their quoted ranges and spreads; the 4.01/10.85 sensitivity figures and 581 rare compound
types reproduce; the remaining exemplar measurements match. The negative-set counts also reproduce:
25 tier 1, 43 tier 2, 184,722 whitespace-delimited control tokens, five demotions, and 215
curly-quote matches across 15 documents. Those control tokens use a different denominator from the
filtered prose-word count.

Additional instruction defects, not preferences

SKILL.md:28,47–55,66. A brief under 150 words cannot be the sole container of every fact permitted
in a substantial technical document. “Anything that did not make the brief does not go in the
document” confuses scope control with evidence exclusion. Make the brief govern the argument; retain
the source material as the authority for supporting detail.

The exemplar-loading instruction is not decorative: it explicitly says “Load,” “Read,” and “always”
at stage 2. But its contract is incomplete:

 - design_doc and postmortem each have three entries, while the instruction promises their
designated two. Identify a primary pair and conditions for alternatives.
 - Several advertised formats, including chapters and course pages, lack a mapping or fallback.
 - “Exemplars outrank every rule” conflicts with binding owner rules and a gate that rejects those
exemplars. Limit exemplar precedence to descriptive voice guidance; truth and explicit task
constraints must remain authoritative.

The extracts also omit material needed to understand some examples: diagrams from shuffle-sharding,
eleven graphs from latency-pitfalls, and formula images from SRE risk. They are usable prose
samples, not uniformly self-contained demonstrations.

SKILL.md:165: “Fixing 4 of 7 sites is worse than fixing 0” is an unsupported universal, not an
editing procedure. Replace it with the actual obligation: update every dependent representation of a
changed claim and disclose unfinished repairs. “Nothing the reader already knows” similarly needs
an explicit audience model.

Clean structural checks: the skill is 211 lines, within the 400-line budget; all ten indexed
exemplar files exist and their bodies match the corpus extracts; the empty status_update mapping is
explicitly disclosed.

Judgment: the refusals are mostly right; their justification needs narrowing

The three overrides are substantively correct. Keep necessary uncertainty, quantify claims that
depend on quantities, and do not impose a universal sentence cap.

Their replacements are not equally useful:

 - Number attachment is actionable: identify the quantity-dependent claim and check metric,
comparison, units, scope and source. But the variance of numbers/100 words does not itself test
whether such claims were properly quantified.
 - Hedge deletion has a useful test: what becomes false or unjustified when the qualification is
removed?
 - Long-sentence review is reasonable, but reporting only a count is weak. Give the sentences and
locations, and require a clause/antecedent review. Do not manufacture a length threshold to replace
that judgment.

The gate also says sentence-length SD below approximately seven “reads mechanical,” although its
passing AWS timeouts exemplar measures 6.234. That diagnosis is not justified by the corpus.

Rejecting the two failed instruments was correct; declaring the quantities inherently unmeasurable
was not. SKILL.md:121 should say “not measured reliably here.”

For concreteness, contextual POS tagging, lemmatization, domain annotation and an explicit treatment
of sentences without a match could improve the instrument. The present permissive detector even
accepts the verb Serialize as a concrete noun. Its permissive and strict means also condition on
different sets of matching sentences.

For coinages, rarity in 30 documents plainly fails. A better measurement needs an operational
definition of novelty, a reference vocabulary or history, and contextual annotation. A closed list
is a useful lint replacement, but it is not a measurement of open-class coinage.

Exemplar selection is defensible as editorial curation, especially for demonstrating that numbers
and sentence lengths vary. It is not established as an optimal genre-specific selection by these
metrics. Two same-author performance essays and several documents about postmortems provide narrower
coverage than the genre labels suggest.

BLOCKERS: 6

 1. skill/references/negative-set.json, reports/phase2-measurements.md: held-out rule-development
provenance must be reconciled.
 2. tools/measure.py, skill/SKILL.md, skill/references/voice.md: semantic interpretations and the
claim-first floor lack valid measurement.
 3. tools/measure.py: sentence splitting and paragraph filtering undermine calibration.
 4. skill/scripts/prose-check.py, skill/references/negative-set.md, tools/install_skill.sh: five
expert-control failures, contextual/flag defects, and fail-open checks.
 5. skill/references/voice.md: technically incorrect or unjustified worked “after” examples.
 6. skill/SKILL.md, skill/references/voice.md, reports/phase2-measurements.md,
skill/references/exemplars/INDEX.json: incorrect numerical claims, rankings and population labels.

