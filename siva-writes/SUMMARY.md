# SUMMARY

One page on what moved the numbers and what did not. Detail in `eval/results.md`, method in
`reports/phase2-measurements.md`, the full change record in `CHANGELOG.md`.

## What was built

A 57-document public corpus split at source-family level (9 train, 4 held out), seven quantities
measured over the train split, a skill rewritten from 1,572 lines to 220 with everything preserved
in `references/`, a held-out evaluation of 40 briefs and 200 comprehension questions built and
frozen before any tuning, 280 documents generated across two rounds, and four metrics.

## What moved the numbers

**Exemplars.** The only intervention that improved comprehension. C beats B by +0.575 [0.105, 1.045]
per brief. Two real documents of the right genre did more than every rule written about them.

**Putting a rate in the gate.** The r2 change was identical text in conditions B, C and D: R2 and R3
now state their measured effect. Causal *so* per 1000 words moved 3.50 to **1.17** in D, below the
held-out human rate of 1.38 and near the corpus at 0.87. It did not move in B (3.00 to 3.03) or C
(3.18 to 3.76). Only D runs the gate. **A rule the writer reads before writing lost to a number the
writer is shown after writing.** That is the most useful thing learned here and it is a claim about
instrument design, not about prose.

**What this is NOT.** An earlier version of this summary said the skill drove the *so* rate up
monotonically with how much of it applied. That was an artifact: the detector applied `^` to the
whole joined document instead of per sentence, missing every sentence-initial *So* after the first,
and counted degree uses like *so deep that it broke the profiler*. Corrected, the model conditions
sit at 3.00, 3.18, 3.50 against no-skill at 3.11 -- **flat, not monotonic**. Models over-use causal
*so* on their own; the skill neither causes it nor, by its rule text, fixes it. Only the gate does.

**R3's suppression, mostly.** *rather than* fell from 2.17 to 0.54 per 1000 words while *instead of*
rose from 0.41 to 1.29, against 0.36 in the corpus. The combined rate of the two fell 28.8%, so the
rule removed some contrast and displaced the rest. Whether the surviving comparisons are real needs
paired semantic inspection that has not been done.

## What did not move the numbers

**The brief-then-prose split and the self-score gate, on comprehension.** C beats D by +0.450
[0.197, 0.703] in round 1 and +0.500 [0.097, 0.903] in round 2. **The result replicates on a second
independent generation**, and it is the answer to the question the brief posed: D does not separate
from C, so the split is not working as designed. D also does not beat A.

**Rules without exemplars.** B trends below A on comprehension in round 1 (-0.125, CI crosses zero),
and D ties A exactly (+0.000). Rules alone, and rules plus staging plus a gate, are both
indistinguishable from no skill. Only the condition with exemplars separates.

**Stating a measurement inside a rule.** See above. The text landed in three conditions and changed
behaviour in the one that also enforced it.

## Two instruments were wrong and one condition was invalid

**Metric 4's surface mode measures subject matter.** It ranked the real human documents as the *most*
over-represented, because their top trigrams are iostat column headers. Replaced with function-word
n-grams, where the human documents are lowest by 5x (0.39 against 1.86-2.72). Both are reported.

**Condition H is invalid in this design.** The blind judge ranked published prose by Brooker,
Cloudflare and Gregg last in **24 of 24 pairs**. Its reasoning names the cause: H is penalised for
omitting material the brief demands, because the briefs were derived from an anchored span while
their facts were drawn from the whole source document. Metric 2 shows it independently at 13.1% of
graded facts. H is reported and excluded from every conclusion. The judge is not broken; a control
did its job.

**The sentence splitter required a capital after the boundary**, so *"Latency fell to 4 ms. p99
stayed flat."* counted as one sentence across a corpus full of `p99` and `kubelet`.

**The extractor counted nested blocks twice.** A `<blockquote><p>...</p></blockquote>` entered the
corpus as two copies. Measured after the fix: the corpus shrank 14.1%, from 286,696 to 246,402
words, with the GCP incident reports about 49% duplicated and Paul Graham's essay 50%. Every
statistic in this repository was recomputed against the deduplicated corpus and republished.

**The comprehension grader matched numbers as an unordered set**, so a reply that reversed two
container allocations, or answered GiB against a GB key, scored correct. 52 item verdicts changed
when it was fixed. Every conclusion here is post-regrade and all survived.

## What is not known

**Metric 1 and Metric 3 have no valid result.** The pairwise judge is unvalidated: Cohen's kappa
against owner labels has not been computed, and its 60 win rates must not gate anything until it
clears 0.6. Metric 3 has not been run at all. It is the metric that distinguishes a skill that saves
editing time from one that relocates its tells, and 50 blind-staged documents are waiting.

**The claim-first statistic is weaker than it looked.** `is_claim_first` is a lexical proxy that
returns true after four exclusions, and an independent review demonstrated that **both of Rule 1's
own bad openings pass it**. The rule is still right; the number is not strong evidence for it.

**Rule development touched held-out material.** Nine negative-set patterns cite Brooker, KEP-2400,
KEP-3521, Cloudflare and Gregg in their exclusion rationales. The firewall was written into the
eval-building workflow and not the negative-set one. No evidence was found of score inflation or of
exposure to the frozen answers, and the nine patterns are five tier-2 and four tier-3, none of them
enforced. But "conservative exclusions cannot change scores" was an assurance I could not support
and it is withdrawn along with the independence claim. Restoring that claim needs a genuinely new,
unexposed validation set.

## What this means for the skill

Keep the exemplars; they are the part that works. Keep the r2 gate change; it moved B beyond the CI
and cut D's worst tic by 3.3x. Treat the brief-then-prose split as unproven and probably costly: it
loses to exemplars-plus-rules on the one metric that measures whether the reader got the content,
twice, on independent generations.

The honest position is that this evaluation establishes **one positive result (exemplars), one
negative result (the staged split), one instrument-design lesson (enforce at the gate, not in the
prose), and two metrics that still need the owner**.
