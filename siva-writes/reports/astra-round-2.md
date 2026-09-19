<!-- model: gpt-6-astra  effort: max  context: long_context  session: dec16d9a-4c82-4b95-8450-8b08a4cf9418 -->
<!-- prompt: reports/astra-prompt-round2.md -->

I’m using writing-skills and systematic-debugging to classify the six repairs against reproducible
evidence, then audit the evaluation and remaining guidance. This will be a read-only review.

The r2 changelog withdraws the strict held-out claim, but also says conservative exclusions cannot
inflate scores; that needs a separate check. I’m splitting the gate/provenance and comprehension
audits from the sentence-measurement and example checks.

The most serious surviving defect is the comprehension instrument: it confuses reader failures,
answer parsing and grading with comprehension. I reproduced a correct formula being rejected, an
incorrect allocation passing with its numbers reversed and units changed, and eight question stems
passing as their own answers. The quoted C-over-D arithmetic reproduces; its measurement and causal
interpretation are not yet trustworthy.

Classification of the six repairs

The bundled blockers have mixed subrepairs; the table names those rather than treating an entire
bundle as fixed.

┌─────────────────┬────────────────────────────┬───────────────────────────────────────────────┐
│ Blocker         │ Classification             │ What happened                                 │
├─────────────────┼────────────────────────────┼───────────────────────────────────────────────┤
│ B1 provenance   │ discharged-but-broken      │ Withdrawing the untouched-holdout claim is    │
│                 │                            │ legitimate. The replacement assurance that    │
│                 │                            │ conservative exclusions cannot inflate any    │
│                 │                            │ condition’s score is unsupported. The current │
│                 │                            │ Phase 2 reference still says the test         │
│                 │                            │ families stayed sealed.                       │
├─────────────────┼────────────────────────────┼───────────────────────────────────────────────┤
│ B2 construct    │ discharged for the         │ The lexical labels, removed semantic floor,   │
│ validity        │ requested downgrade        │ quoted-question correction and softened       │
│                 │                            │ mechanism ratio are real. Both bad openings   │
│                 │                            │ are now explicitly acknowledged as passing    │
│                 │                            │ the proxy. These changes do not validate the  │
│                 │                            │ classifiers, but they stop the principal      │
│                 │                            │ misuse.                                       │
├─────────────────┼────────────────────────────┼───────────────────────────────────────────────┤
│ B3              │ discharged-but-broken for  │ The original boundary probes now pass. The    │
│ preprocessing   │ splitting; paragraph       │ replacement introduces false boundaries in    │
│                 │ filtering not-addressed    │ real PEP text. The short-paragraph exclusion  │
│                 │                            │ and unsupported segmentation-reliability test │
│                 │                            │ remain.                                       │
├─────────────────┼────────────────────────────┼───────────────────────────────────────────────┤
│ B4 gate         │ Missing/noncompiling       │ The installer runs ten controls but now       │
│                 │ configuration discharged;  │ accepts ten checker crashes as success.       │
│                 │ installer                  │ Missing configuration keys can still disable  │
│                 │ discharged-but-broken;     │ enforcement.                                  │
│                 │ contextual defects         │                                               │
│                 │ not-addressed              │                                               │
├─────────────────┼────────────────────────────┼───────────────────────────────────────────────┤
│ B5 examples     │ Four original technical    │ The arithmetic and several qualifications are │
│                 │ corrections discharged;    │ corrected. The attention replacement still    │
│                 │ attention inference        │ asserts an unjustified runtime transition,    │
│                 │ not-addressed; new         │ and a replacement pair changes the event      │
│                 │ chronology pair            │ sequence it claims to preserve.               │
│                 │ discharged-but-broken      │                                               │
├─────────────────┼────────────────────────────┼───────────────────────────────────────────────┤
│ B6 numbers      │ not-addressed as a         │ The current measurement JSON reproduces, and  │
│                 │ complete publication       │ several headlines are corrected. Numerous     │
│                 │ repair                     │ active claims and eight of ten exemplar       │
│                 │                            │ headers still disagree with it.               │
└─────────────────┴────────────────────────────┴───────────────────────────────────────────────┘

I found no basis for calling the original six blockers unnecessary. Making every unchanged expert
exemplar obey the owner’s punctuation and connector preferences would, however, be unnecessary; the
narrowed zero-tier-1 control is the right distinction.

Surviving and introduced defects

The installer repair defeats its own safety check. At tools/install_skill.sh:56-69, || true discards
checker status, and the validator looks only for the text tier-1 pattern. I injected exit status 2
into all ten checker invocations, stopping before installation operations. Validation returned:

 gate ran on all 10 exemplars, 0 tier-1 hits                ok
 exit=0

A tier-1 positive control correctly failed. Separately, replacing the pattern configuration with {}
in memory made both validators accept zero patterns; the real configuration rejected the same prose.

The intentionally deferred B4 defects still divide as follows:

 - Multiline handling matters: the same heading changes disposition when moved below a paragraph.
Adding re.M alone is not a repair: it also rejects the genuine Rust heading ## How We Teach This.
 - Exceptions matter: legitimate upfront summaries, Markdown links and attributed inline quotations
still receive hard failures. Short paragraphs bypass R2, while valid tilde-fenced code can trigger
prose failures.
 - Truncated regex displays remain wrong documentation, but are not a runtime compilation failure:
all 68 runtime regexes compile. Four displayed expressions fail compilation and a fifth is
incomplete. Publish the complete expressions or explicitly point to JSON as the executable
specification.

B1 needs corrected disclosure, not automatic pattern regeneration. The nine exposed patterns
reproduce as five tier-2 and four tier-3 patterns, with none in tier 1. Keep useful rules as
development-informed house lint. Conservative exclusions can change scores and generation/revision
behavior; they do not prove a zero effect. I found no evidence establishing actual score inflation
or exposure to frozen answers. Remove that assurance from CHANGELOG.md:86-89, and update or
explicitly archive reports/phase2-measurements.md:4-5. A genuinely new, unexposed validation set is
needed to restore an independence claim.

B3 still changes the population being measured. The new splitter turns the actual PEP phrase
languages with generics (e.g. Java, TypeScript). into two sentences. It similarly splits e.g.
Django; the prior implementation did not. Removing titles also turns Dr. Smith ... into a sentence
ending at Dr. (tools/measure.py:64-75).

The larger new finding is upstream: tools/fetch_corpus.py:90-94 extracts both enclosing
blockquote/li/td elements and their nested paragraphs. A single <blockquote><p>...</p></blockquote>
becomes two copies. In the training HTML, I counted 23,315 repeated word contributions caused by
selecting the same source text nodes through multiple ancestors; several GCP extracts approach
one-half duplicated contributions. These are extraction duplicates, not merely an author repeating a
point. Recomputing statistics over those extracts reproduces the defect.

The 25-word floor still removes substantive short paragraphs. The 300-word guard still accepts
doubled-up AWS paragraphs as reliable. These statistics must describe retained blocks, not
unrestricted prose paragraphs.

B5 still teaches false or unsupported inferences. I checked all 18 pairs.

 - voice.md:194-199: exceeding on-chip capacity does not establish that runtime stops tracking
operation count or becomes bandwidth-bound. Tiling, traffic and hardware rates are missing. Even
when both operations and memory traffic scale as S^2, bandwidth-bound runtime can still scale as
S^2.
 - voice.md:249-258: the before says throughput recovered and latency followed; the after says they
recovered together. The explanation then claims to preserve their order. That is a new semantic
error, not a sentence-length preference.
 - voice.md:52-55: concentrating requests on resident keys is ordinarily helpful to cache hit rate.
The example supplies no baseline or trace that justifies naming that concentration as a cause of
lost hits.
 - The new route-lookup example supplies 50 lookups/s and a five-second timeout without the offered
load or backlog needed to explain that wait. A cold cache alone is insufficient; approximately 250
requests ahead would supply the missing calculation under a simple FIFO model.

The corrected shuffle probabilities, retry alternatives and fully allocated pool arithmetic are
clean. So are 19.2/10.1 = 1.901 and 12/30 = 40%; the latter is a serial-path budget comparison, not
permission to add component percentiles.

B6 was not propagated across the live references. All 30 current document rows, 16 overall
aggregates and 144 family aggregates reproduce. That does not make these published claims current:

┌───────────────────────────┬─────────────────────────────────┬────────────────────────────────┐
│ Location                  │ Still published                 │ Current result                 │
├───────────────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ SKILL.md:153              │ 22.8% over 30 words; Dan Luu    │ 21.673% document-weighted; Dan │
│                           │ 47%                             │ Luu 45.634%                    │
├───────────────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ SKILL.md:131-132,         │ Concrete-word sensitivity       │ 3.985/10.712; 54.031%          │
│ voice.md:322-323          │ 4.01/10.85; no-match 53.5%      │ document-weighted              │
├───────────────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ voice.md:115              │ Mechanism ratio minimum 0.33    │ 0.318                          │
├───────────────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ voice.md:171              │ Design-doc document hedges most │ Highest family mean, not       │
│                           │                                 │ highest document               │
├───────────────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ exemplars/INDEX.json:42   │ 7.40 highest in corpus          │ Highest selected exemplar;     │
│                           │                                 │ corpus maximum 9.556           │
├───────────────────────────┼─────────────────────────────────┼────────────────────────────────┤
│ Eight exemplar headers    │ Old sentence-derived            │ For example, PEP-572 claim     │
│                           │ measurements                    │ proxy 0.917 versus 0.896       │
└───────────────────────────┴─────────────────────────────────┴────────────────────────────────┘

The pooled figures 1,473/7,040 sentences and 307/1,953 eligible paragraphs are correct. The Phase 2
report is largely an unrelabelled old snapshot, despite being linked as the current derivation.

What the evaluation establishes

The causal-“so” measurement is not sound as named

tools/construction_rates.py:18,27-30 counts the human passage “so deep that it broke Linux’s perf
profiler” as a causal connector. More consequentially, ^ is applied to all documents joined
together, not to each sentence. It misses ordinary sentence-initial causal connectors and loses
subsequent document starts.

I manually checked the omitted sentence-initial occurrences in A-D. Adding only those verified
misses gives this sensitivity check:

┌──────────────────────────────────────────┬───────┬───────┬───────┬───────┐
│ Per 1,000 words                          │ A     │ B     │ C     │ D     │
├──────────────────────────────────────────┼───────┼───────┼───────┼───────┤
│ Published regex                          │ 2.660 │ 2.915 │ 3.137 │ 3.463 │
├──────────────────────────────────────────┼───────┼───────┼───────┼───────┤
│ Plus missed sentence-initial occurrences │ 3.192 │ 3.000 │ 3.221 │ 3.546 │
└──────────────────────────────────────────┴───────┴───────┴───────┴───────┘

The claimed monotonic increase disappears. This is not a replacement validated classifier: the
expression also excludes consequential uses such as so that workstream lost its owner, where that
modifies workstream. The gate adds another mismatch: its document-rate numerator scans the whole
comment-stripped document, while its denominator counts only retained paragraphs.

R2 may encourage the construction, but these results do not isolate R2 from the other instructions
or establish the published semantic rates. Validate consequential, purposive, degree, discourse and
anaphoric uses against annotated text, then run an R2-only ablation.

R3 shows partial substitution, not proof that no contrast was removed. The combined rate of the two
phrases falls from 2.578 to 1.836, a 28.8% reduction. Whether the remaining comparisons are genuine
or performative requires paired semantic inspection.

C-over-D is a recorded-score result, not an identified briefing penalty

The quoted result is generation round 1: C scores 152/200 and D 136/200. The paired difference is
exactly +0.400 correct answers per five-question brief, [0.180, 0.620], 17 wins, 3 losses, 20 ties.
The interval is a normal paired interval, not a bootstrap interval; alternative paired intervals do
not remove its positive sign.

But tools/comprehension.py:65-81,115-122 has demonstrated measurement failures:

 - The complete correct formula E[X^2] / (2 E[X]) fails; an unfinished version containing both 2 and
0.5 passes. Even 2 plus0.5 passes.
 - Reversing the containers’ allocations and changing GB to GiB passes because the numeric set
matches.
 - Answer continuations are dropped; numbered sublists overwrite earlier answers; reader exit
failures can become empty answers without an error.

Four clear D false negatives alone reduce C-D to +0.300 [0.076, 0.524]. That is a sensitivity
analysis, not a complete regrade or evidence that the entire difference disappears.

Two evaluation repairs are specifically discharged-but-broken: design_doc-03-q1 now asks for the
replacement hash key but its keys additionally require the displaced packet-address key;
design_doc-05-q2 now asks for a paper result but its keys additionally demand Figure 6. Correct
short answers fail, including equivalent C/D answers receiving different outcomes.

Length does not support the simple compression explanation. C averages 618.025 whitespace words, D
617.325; paired difference +0.7 [-9.62, 11.02]. Most of C’s net advantage occurs on briefs where D
is longer. Length is also a post-treatment variable, not a baseline confound for the whole-package
effect.

The treatments do not identify the brief’s effect. D adds full-skill guidance, briefing and
gate/revision instructions. Actual drafts, gate invocations and revision diffs are not archived.
Worse, generate_workflow_r2.js:70-71 still says to write from the brief, “not from the raw
material,” excluding anything absent from that brief. It also retains absolute exemplar precedence.
Both contradict the repaired skill. These conflicts do not prove which instructions writers
followed.

C and D share exemplars, so exemplar presence alone cannot explain their contrast. Conversely, B and
C have identical intended treatments for the eight no-exemplar status briefs, yet C-B is +0.5
there. One generation per cell cannot establish that exemplars did all the work. The reported D-A
and B-A intervals both include zero; they establish neither superiority nor equivalence.

A newer result appeared during this review and is now committed. In eval/results-metric2-r2.json,
five D documents receive five empty answers each, while reader_errors remains zero. Those rows
account for 15 of C’s net 20-question advantage. Excluding only those unusable rows gives +0.143
[-0.180, 0.466], not a repaired estimate. The new eval/results.md:152-173 claims about “one change”
and strong replication are unsupported. The fixed unmatched-output filename also overwrote the first
round’s unmatched records.

To distinguish the explanations:

 1. Hold the 160 documents fixed, repair parsing/grading, preserve raw responses and errors, and
blind-check answerability separately from reader accuracy. Include a question-only reader baseline.
 2. Factor briefing on/off × gate/revision on/off, holding other guidance, exemplars and budgets
constant. Save every intermediate artifact and repeat writer/reader samples.
 3. Add an exemplar-only arm and retain the no-exemplar genre control. Annotate essential facts
versus incidental recall; otherwise a focused document can lose trivia points without becoming less
useful.

Remaining reference issues and clean coverage

These are not requests to change the owner’s taste. craft.md:559,644 still instructs that fixing
four of seven sites is worse than fixing none, after the main skill withdrew that universal. Its
acronym-introduction example at line 295 says “passes” without expanding the acronyms required by
the preceding rule. The owner-examples link to SKILL.md is broken relative to that file, and
chapters/course pages still lack an exemplar mapping or fallback.

The hedge counter also needs its lexical limitation stated: it counts topic uses of about and
spatial/idiomatic uses of around. Its rate cannot establish the claimed epistemic ranking. Keeping
necessary uncertainty remains good guidance independently of that statistic.

Two further evaluation-data defects remain: the outage brief compares Var(X) with E[X], quantities
with different units; the relevant condition uses Var(X)/E[X]^2. Three repaired fact values also
contain serialized {key,value} objects instead of the intended values. The latter is damaged repair
output, not an explanation of C-D: writers receive the raw prompt, not that facts array.

Clean coverage includes all ten exemplar runs with zero tier-1 hits, the 25/43 tier counts and train
controls, frozen prompt/question/judge hashes, the quoted paired-score arithmetic, all 18 voice
pairs, and the owner examples’ attention equivariance, KV storage, GQA intensity, parameter matching
and scalar-product corrections. I read all current guidance files and the exemplar index, checked
all ten exemplar headers, and read two exemplars in full. I did not remeasure the historical
external-site or learning-centre UI observations, nor treat synthetic-reader agreement as human
evidence.

BLOCKERS: 8

 1. tools/comprehension.py, eval/questions.jsonl, eval/results-metric2*.json: invalid grading and
unreported reader failures.
 2. tools/generate_workflow*.js, eval/conditions/D.md, eval/results.md: contradictory treatment
instructions, missing revision evidence and unsupported causal/replication claims.
 3. tools/install_skill.sh, skill/scripts/prose-check.py, skill/references/negative-set.md:
false-success validation and inconsistent enforcement scope.
 4. tools/measure.py, tools/fetch_corpus.py: splitting regressions, biased paragraph selection and
duplicated extraction.
 5. skill/references/voice.md: surviving technical inference errors and a newly changed chronology.
 6. tools/construction_rates.py, skill/scripts/prose-check.py, skill/SKILL.md, CHANGELOG.md: invalid
causal-connector measurement and overinterpreted effects.
 7. CHANGELOG.md, reports/phase2-measurements.md: unsupported provenance assurances and unreconciled
holdout wording.
 8. skill/SKILL.md, skill/references/voice.md, skill/references/exemplars/,
skill/references/craft.md, reports/phase2-measurements.md: incomplete propagation of corrected
measurements and withdrawn instructions.

