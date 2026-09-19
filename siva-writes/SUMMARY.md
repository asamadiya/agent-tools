# SUMMARY

One page on what moved the numbers and what did not. Detail in `eval/results.md`, method in
`reports/phase2-measurements.md`, the full change record in `CHANGELOG.md`.

## What was built

A 57-document public corpus split at source-family level (9 train, 4 held out), seven quantities
measured over the train split, a skill rewritten from 1,572 lines to 220 with everything preserved
in `references/`, a held-out evaluation of 40 briefs and 200 comprehension questions built and
frozen before any tuning, 280 documents generated across two rounds, and four metrics.

## What moved the numbers

**Exemplars.** The only intervention that improved comprehension. C beats B by +0.650 [0.187, 1.113]
per brief. Two real documents of the right genre did more than every rule written about them.

**Putting a rate in the gate.** The r2 change was identical text in conditions B, C and D: R2 and R3
now state their measured effect. Causal *so* per 1000 words moved 3.46 to **1.04** in D, below the
held-out human rate of 1.14. It did not move in B (2.91 to 2.95) or C (3.14 to 3.68). Only D runs
the gate. **A rule the writer reads before writing lost to a number the writer is shown after
writing.** That is the most useful thing learned here and it is a claim about instrument design, not
about prose.

**R3's suppression, in one direction only.** *rather than* fell from 2.17 to 0.54 per 1000 words.
*instead of* rose from 0.41 to 1.29 over the same interval, against 0.36 in the corpus. The rule
moved the construction; it did not remove it.

## What did not move the numbers

**The brief-then-prose split and the self-score gate, on comprehension.** C beats D by +0.400
[0.180, 0.620] in round 1 and +0.500 [0.073, 0.927] in round 2. **The result replicates on a second
independent generation**, and it is the answer to the question the brief posed: D does not separate
from C, so the split is not working as designed. D also does not beat A.

**Rules without exemplars.** B trends below A on comprehension in round 1 (-0.350, CI crosses zero).
Rules alone are not better than no skill; they become better when a document is attached to them.

**Stating a measurement inside a rule.** See above. The text landed in three conditions and changed
behaviour in the one that also enforced it.

## Two instruments were wrong and one condition was invalid

**Metric 4's surface mode measures subject matter.** It ranked the real human documents as the *most*
over-represented, because their top trigrams are iostat column headers. Replaced with function-word
n-grams, where the human documents are lowest by 5x (0.36 against 1.86-2.72). Both are reported.

**Condition H is invalid in this design.** The blind judge ranked published prose by Brooker,
Cloudflare and Gregg last in **24 of 24 pairs**. Its reasoning names the cause: H is penalised for
omitting material the brief demands, because the briefs were derived from an anchored span while
their facts were drawn from the whole source document. Metric 2 shows it independently at 13.1% of
graded facts. H is reported and excluded from every conclusion. The judge is not broken; a control
did its job.

**The sentence splitter required a capital after the boundary**, so *"Latency fell to 4 ms. p99
stayed flat."* counted as one sentence across a corpus full of `p99` and `kubelet`. Every
sentence-derived number moved when it was fixed, and all were republished.

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
eval-building workflow and not the negative-set one. The exclusions only make patterns more
conservative and the frozen questions were never exposed, but the strict held-out claim is withdrawn.

## What this means for the skill

Keep the exemplars; they are the part that works. Keep the r2 gate change; it moved B beyond the CI
and cut D's worst tic by 3.3x. Treat the brief-then-prose split as unproven and probably costly: it
loses to exemplars-plus-rules on the one metric that measures whether the reader got the content,
twice, on independent generations.

The honest position is that this evaluation establishes **one positive result (exemplars), one
negative result (the staged split), one instrument-design lesson (enforce at the gate, not in the
prose), and two metrics that still need the owner**.
