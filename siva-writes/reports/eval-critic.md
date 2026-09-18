**Structural (blocks three of the requested checks outright)**

- ALL BRIEFS: the JSON contains no prompt/instruction field. Every brief is `{brief_id, questions}` only. The check for "prompt smuggles finished prose or style instruction" cannot be run — there is nothing to inspect. Either the briefs were never written (only their answer keys were) or the prompt was stripped before handing it to me.
- ALL BRIEFS: no `has_human` field, no anchor-word list. The verbatim-vs-paraphrase check is unrunnable. Not clean — missing.
- ALL BRIEFS: no source pointer (`corpus/text/*.txt` filename), no family label, no TRAIN/HELD-OUT marking, no source date/version. Disputed answers cannot be adjudicated, and the firewall's own TRAIN-family exclusion cannot be verified from this artifact.
- PACK 3: truncated. `postmortem-07` Q5's accept list ends mid-token (`"U`), and there is no `postmortem-08`. Packs 1 and 2 have 8 briefs; pack 3 has 7 (at best).
- ALL BRIEFS: every item is short-answer factual recall. Nothing anywhere tests structure, section ordering, heading discipline, hedging, register, or format — i.e. the things a writing skill actually does. As an instrument this measures fact retention only.

**"8 briefs are really 3 briefs repeated"**

- `rfc-01`, `rfc-02`, `rfc-03` are three sections of one KEP (in-place pod vertical scaling). `rfc-04`, `rfc-05`, `rfc-06` are three sections of one KEP (node swap; `rfc-05` is the swap-limit-calculation section of the doc `rfc-04` introduces). `rfc-07`, `rfc-08` are one KEP (scheduling gates). 8 rfc briefs = 3 source documents, all in the identical k8s KEP template — one voice tested eight times.
- `postmortem-01` and `postmortem-02` are the same incident (02 is the impact/scope section of 01's writeup). `postmortem-04` and `postmortem-05` are the same incident (05 is the remediation section of 04). 7 postmortem briefs = ~5 incidents, all from one company's incident-blog house style.
- `design_doc-01` … `design_doc-08` all read as one blog author's voice. Across 23 briefs the eval samples three authorial voices total.
- `design_doc-06`, `design_doc-07`, `design_doc-08` are opinion essays/anecdotes, not design docs. `design_doc-01`, `design_doc-02`, `design_doc-03` are analysis notes. Only `design_doc-04` and `design_doc-05` are architecture prose. The genre label is wrong for 6 of 8, so "design doc" is effectively tested twice.
- Genre gaps: no handbook/chapter, no course or lesson page, no internal LinkedIn artifact, no PR description, no short-form writing, no "rewrite this slop" case. Every source is third-party published prose.

**Arithmetic that does not hold**

- `design_doc-02`: Q2 and Q3 contradict by a factor of two. Q2 gives `E_a[X] = E[X²]/(2E[X])`. Q3's pair (median 30 min, p99 600 min → MTTR "just over 1 hour", customer mean "near 6 hours") only works without the `/2`. Lognormal fit: mu = ln30 = 3.401, sigma = (ln600 − ln30)/2.326 = 1.288; mean = exp(mu + σ²/2) = 68.7 min ✓ "just over an hour"; but `E[X²]/(2E[X]) = 0.5·exp(mu + 1.5σ²)` = **181 min ≈ 3 hours**, not 6. `E[X²]/E[X]` = 361 min = exactly the quoted 6 hours. One of the two items is wrong and a grader marking both from the key will mark a correct model wrong. (A Pareto fit is worse: α = 1.31 < 2, so E[X²] is infinite and there is no 6-hour answer at all.)
- `design_doc-04` Q1: canonical answer says the ratio reduces "approximately sqrt(number of loads)" while accept string 3 says "~1/sqrt(number of loads)". Those are reciprocals. The physically correct statement is that peak/average falls toward 1 as ~1/sqrt(n); the answer field as written is dimensionally backwards and the accept list disagrees with itself.
- `design_doc-01` Q1/Q2: not reproducible. The question names five values (1, 10, 200, 10000, 20000 ms) but never says which percentiles they are, and never states the interpolation/extrapolation rule. Q4 says L requires the raw samples (`sum(sorted(x)[:k])/sum(x)`), which the brief does not provide. 0.5171 cannot be checked against anything; a naive band computation off plausible levels gives ~33%. Q1 and Q4 are in tension inside the same brief.
- `rfc-05` Q4: the worked example's `TotalPodsSwapAvailable = 38G` is never established by any question in the brief (Q3 defines the quantity only symbolically). 19 G and 9.5 G are unverifiable from within the brief. Units also drift across the key: "19 GB" in the answer, "19 GiB" in the accept list, "19G" in the derivation.

**Internal contradictions / adjudication hazards**

- `rfc-05` Q1 vs Q2: Q1 states the proportion is `memory request / node physical memory`. Q2 asserts a container with requests == limits has proportion 0. The formula in Q1 does not produce 0 for that case; the Guaranteed-QoS special case is never stated, so the two answers conflict on their face.
- `rfc-05` Q2 vs Q5: same fact twice ("requests==limits gets no swap" and "only Burstable gets swap") — 2 of 5 items in the brief are one fact.
- `rfc-04` Q1 vs `rfc-05` (whole brief): `rfc-04` says per-workload swap limits are deferred to a follow-up KEP; `rfc-05` is entirely about per-container swap limit calculation. Graded independently with no source context, these read as contradictory.
- `design_doc-06` Q1 vs Q5: one fact asked twice (which cost hasn't dropped / what is solved vs scarce).
- `postmortem-04` Q5 vs `postmortem-05` Q5: the same recovery-class fact from the same incident, counted twice across two briefs.
- `design_doc-08` Q4's wording ("why does that ordering **invert**") gives away the answer to the interesting half of Q3.

**Not actually checkable / unfalsifiable**

- `design_doc-06` Q2/Q3: an unnamed "analog-circuit expert", "wrong by ten or more orders of magnitude … measured by the ratio of digital to analog transistors in 2026", "made a small fortune, enough to keep his children comfortable". No entity, no source, no measurable quantity. Q3 is anecdote, not fact.
- `postmortem-05`: the whole brief is planned/future remediation ("will be", "planned fix", "will trip"). With no source date stamp these are not facts, and they are falsified by any later post.
- `design_doc-07` Q2: "at least 85 years" is a relative-to-publication figure. From Rejewski's 1930s work to today's date (2026) is 88–96 years; a correct model answering "about 90 years" gets marked wrong.
- `rfc-03` Q3 ("before v1.31, with the gate disabled…"): version-relative, undated, and already historical.

**Answerable from world knowledge or from their own wording**

- `design_doc-03` Q1: "Who published SFQ and in what year" — pure world knowledge (McKenney, 1990). Zero source signal.
- `design_doc-05` Q5: Dynamo 2007 / Vogels' *Eventually Consistent* 2009 — pure world knowledge.
- `design_doc-05` Q1: "practical advantage of OCC beyond throughput" → "clients never block clients" is the textbook line.
- `design_doc-06` Q4: "which law explains where value moves when one part becomes free" → Amdahl is the only candidate; the setup is the answer.
- `design_doc-08` Q1: the hypothesis is *named* "feedback loop hypothesis"; the answer is "availability of feedback". Self-answering.
- `design_doc-01` Q5: "alpha > 1 or the mean is infinite" is standard heavy-tail statistics.
- `rfc-06` Q3: tmpfs `noswap` requires kernel 6.4 — real-world kernel fact.
- `rfc-03` Q1: containerd 1.6.9 — recoverable from release notes, not from this doc specifically.
- `rfc-04` Q2: "how much swap by default" → "zero" is the safe-default guess any model makes.
- `rfc-04` Q5 and `rfc-06` Q2: both are "why is X a non-goal", and both accept the generic "it's an OS-level concern / already settable". The question's own framing supplies the answer shape.
- `rfc-02` Q3: "why must the call be idempotent" — the generic answer (replays must be harmless) scores without reading anything.
- `postmortem-06` Q4: "why did restarting make it worse" → thundering herd. Standard incident vocabulary.
- `postmortem-04` Q3: "why did connections hang rather than fail" → generic "retried/searched for a route until timeout" earns the point without the BGP-path-hunting term.
- `postmortem-02` Q2: yes/no item. 50% by coin flip, and the framing telegraphs "No". Delete or rewrite.

**Answer keys leak the source's voice**

- The accept lists carry the authors' own idiom verbatim: `design_doc-08` Q4 "slow, squishy and inconsistent"; `design_doc-06` Q2 "graceless, unreliable and full of problems", Q3 "made a small fortune … because the world changes slower than anyone would like"; `postmortem-04` Q3 "wander the Internet looking for a route"; `postmortem-05` Q3 "their traffic keeps being served instead of going down". If the harness ever shows a key to a generating model, these hand back the target voice — the exact leak this eval exists to prevent.

**Grading mechanics**

- Compound multi-part items graded against one accept string will produce false negatives: `design_doc-02` Q1 (four numbers), `design_doc-04` Q3 (three lessons), `rfc-01` Q2 (three circumstances), `rfc-04` Q1 (two covered + one deferred), `postmortem-02` Q3 (two windows + a cause), `postmortem-04` Q2 (count + denominator + window), `postmortem-05` Q5 (three classes).
- Accept lists mix exact values with answers loose enough to be guessed: `design_doc-01` Q1 accepts "about half" (the obvious guess for a tail-heavy distribution); `rfc-04` Q2 accepts "none by default"; `design_doc-01` Q2 accepts "0.99" and "99.4%" with inconsistent rounding against a stated 0.9938.