# CHANGELOG

`~/.claude/skills/siva-writes` is a symlink to `skill/` in this repository, so every commit here is
live immediately. Run `bash tools/install_skill.sh` after any change: it validates the frontmatter,
checks that every referenced file exists, runs the gate against a human exemplar, and compiles every
negative-set regex before swapping. It refuses to install rather than leaving a broken skill in place.

The pre-change skill is preserved at `baseline/skill-v0/` (1571-line SKILL.md) and is not
discoverable as a skill.

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
