You are reviewing a writing skill for a distinguished-engineer-level technical writer. Be
adversarial. I want the things that are wrong, not a summary of what the files say.

## What to read

Repository: /home/spopuri/my_stuff/agent-tools/siva-writes

  skill/SKILL.md                      the skill itself, 211 lines, budget 400
  skill/references/voice.md           six rules, each with its measurement and 3 before/after pairs
  skill/references/negative-set.md    machine-checkable AI-tell patterns (tier 1 fails, tier 2 flags)
  skill/references/exemplars/INDEX.json  which exemplars load for which document type
  skill/scripts/prose-check.py        the stage-3 gate
  reports/phase2-measurements.md      the full measurement write-up, including what failed
  corpus/measurements-train.json      raw per-document numbers, 30 documents, 9 train families
  tools/measure.py                    the instrument that produced them

## What this is

A distillation, not a training run. A corpus of 57 public documents was fetched and split at
source-family level, 9 families train and 4 held out. Seven quantities were measured over the train
split. Rules were written from those measurements. A held-out eval of 40 briefs and 200
comprehension questions was built first, by agents that never read the skill, and frozen.

## The claims I want attacked

1. **Three axes were deliberately overridden.** The original specification asked for "no sentence
   over 30 words", "every claim numbered", and "zero hedges". All three were refused on measurement:
   22.77% of corpus sentences exceed 30 words and danluu runs 47.0%; numbers per 100 words has sd
   1.267 against mean 1.334; hedges run 1.383 per 100 words and the document that teaches design-doc
   writing hedges hardest at 2.45. Check the arithmetic in corpus/measurements-train.json. Then tell
   me whether the refusals are correct, and more usefully, whether the *replacements* are any good -
   a rule that reports a number and sets no threshold may be honest and useless.

2. **Two requested measurements were declared unmeasurable**: words before the first concrete noun
   (17.73% lexicon OOV, two defensible treatments giving 4.01 and 10.85), and hyphenated coinages
   (rarity proxy returns 581 types including `all-hands` and `api-level`). Is declaring them
   unmeasurable right, or is it giving up on something a better instrument would reach?

3. **claim_first_share = 0.893, sd 0.062, n=29** is the load-bearing result and the one rule stated
   with a floor. The classifier is in tools/measure.py, function `is_claim_first`. Attack it. What
   prose does it misclassify in each direction? Is 0.758 a floor or an artifact of the six documents
   nearest it?

4. **The gate fails on very little.** Only R11 em dashes, R2 double-"so", R3 rather-than budget, and
   tier-1 negative patterns fail; everything else reports. Is that split right, or is it a gate that
   will be ignored because it never says no?

5. **The exemplars are asserted to outrank the rules.** Ten documents, chosen on measured properties.
   Read INDEX.json's rationale per exemplar. Is the selection defensible, and does SKILL.md actually
   make a writer load them, or is that instruction decorative?

## Specific things to check rather than opine on

- Does SKILL.md contain any rule that the corpus measurements contradict? Name it and cite the number.
- Does any before/after pair in voice.md have an "after" that is worse than its "before", or that
  demonstrates a different rule than the one it sits under?
- Are the numbers quoted in SKILL.md consistent with corpus/measurements-train.json? Check each one.
- tools/measure.py: is the sentence splitter correct? Is `is_claim_first` doing what its prose claims?
  Is the paragraph-segmentation reliability guard (mean > 300 words) principled or arbitrary?
- prose-check.py: run it on skill/references/exemplars/*.txt. It should pass human expert prose. If
  it fails any of them, that is a defect in the gate, not in the exemplar.
- Is anything in SKILL.md unfalsifiable, unactionable, or true-but-useless?

## How to answer

Lead with the most serious defect. For each finding give the file, the specific line or claim, what
is wrong, and what would make it right. Separate "this is wrong" from "I would have done it
differently" and say which you are doing.

If a section is clean, say so in one line and name what you checked, so I know the coverage rather
than only the findings. A review that reports only findings has not told me what it read.

End with: BLOCKERS: <n>, and list them by file. If there are none, say "BLOCKERS: none" and then
tell me what would have to be true for you to sign this off, since you are not being asked to.
