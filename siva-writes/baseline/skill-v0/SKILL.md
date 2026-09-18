---
name: siva-writes
description: >
  Use when authoring or rewriting substantial technical prose for Siva: handbooks, chapters,
  RFCs, design docs, and course pages. Also use for "siva-writes", "rewrite this properly",
  "this reads like slop", or prose that "reads like AI wrote it".
---

# siva-writes

Write about what a tensor, byte, GPU, person, or other relevant actor does. Give the reader the
fact, calculation, or experiment. Name the topic in the heading.

| § | | § | |
|---|---|---|---|
| 0 | Current contract and scope | 7B | Kinds of intuition |
| 1 | Metadiscourse | 8 | Visual richness |
| 2 | Characters and actions | 8A | Margins and secondary columns |
| 3 | Dash punctuation | 8B | The figure that reads as pasted on |
| 4 | Hedging | 8C | Colour, and the tension the owner has to settle |
| 5 | Headings | 9 | Math and LaTeX |
| 6 | Organisation | 9A | One object, more than one angle |
| 6A | Page shape: teach the page, do not state it | 10 | Sentences |
| 6B | Introducing a term | 11 | Diagnosing prose that "reads like AI wrote it" |
| 7 | Mechanism, alternatives, and boundary | 12 | Rewriting an existing document safely |
| 7A | Negation, contrast, and where a caveat goes | 13 | Reading list |

**Owner instructions R1–R12 below take precedence over the older advisory statements and measured
thresholds in this file.** They are editing requirements, not claims about what all good writers do.
Counts can detect a violated constraint; they cannot establish good style or human authorship.
The owner decides whether the writing works.

---

## 0. Current contract and scope

**Until the owner gives LGTM, the application scope is `/paths/llm/forward-pass-path` and
`/courses/transformer-internals`, plus this skill.** This is not permission for a corpus-wide rewrite.
The current review set is four rendered pages: the path, the course landing page, the MLP pilot
(`?unit=the-only-nonlinearity`), and the residual pilot (`?unit=the-bus-everything-writes-to`).
The owner explicitly includes every figure those pages deliver, including disclosures and dialogs.
Derive that set from rendered pages; filename prefixes do not describe delivery. Leave the other
ten lessons and unrelated prose unchanged. A skill-only assignment changes no application files
and starts no build, gate, or browser server.

### The standard the material is written against

The owner, signing off the pilot pages and setting the bar for what comes after them:

> "the test is how confidently I can speak about these topics to other leaders with breadth and
> depth"

**That is a spoken-defence standard, not a recall standard**, and it decides what a page owes.
[HOUSE RULE, taken from the owner's sentence. It sets the target; it gates nothing.] Three
consequences bind the writing:

- **Every load-bearing claim must be statable.** The reader has to say it in their own words, give
  the reason it holds, and name the boundary where it stops. A page that leaves them able to
  *recognise* a claim has not met this standard, and recognition is what a fluent page produces by
  default.
- **A number is only useful if the reader can say where it came from.** Under a colleague's
  question an unattributed number costs the speaker the rest of the argument, so R12's arithmetic,
  units and source are part of what the reader carries away rather than the author's private
  workings.
- **"Burned into the brain" is a retention requirement**, and this file's existing answers to it are
  §6's one canonical example carried through the whole document, §8C's recurring role palette, and
  §9A's cross-linked angles on one object. Meeting the same instance again in a *different* register
  is what survives a week. Meeting it again in the same register is what R5 deletes.

§6A's element 8 asks takeaways to tie back to the bigger picture. Under this standard a takeaway
has a harder job: **it is the sentence the reader will say out loud**, so it carries its own reason
and its own boundary and stays true when quoted with the page taken away.

### The owner rules

| Rule | Write this way | Check |
|---|---|---|
| **R1. Actor** | Put the relevant concrete actor or technical object in the subject: a tensor, byte, GPU, kernel, tokenizer, matrix, model, or **we**. | Replace abstract nouns acting as people and document-agents such as *the step argues / prices / recovers*. A technical term can be a legitimate subject. |
| **R2. Connection** | Use **so** for a causal consequence and **and** for a list or conjunction. At most **one so per sentence**. | Name the actual cause. Split a second consequence into a new sentence; changing a connector cannot establish causality. |
| **R3. Comparison** | Use **instead of** for a real comparison. State the positive fact without performing a contrast. At most **one rather than per rendered page**. | Count authored titles, summaries, cards, body, and captions together. Keep logical negation needed for truth; *not invariant* can be essential. |
| **R4. Ending** | End a paragraph on a computed number or a full active sentence. | Remove aphoristic fragments such as *Two regimes, one machine.* Headings and UI labels have their own form. |
| **R5. Once** | Say the fact once. | Delete the sentence that explains the sentence just read. A second representation earns space by adding a calculation, boundary, or experiment. |
| **R6. Delivery** | Deliver the fact now, or link using the destination's content. | Replace *the physics track*, *the step gives it*, and promises of an argument with the result or a link such as *KV storage and the bandwidth roofline*. |
| **R7. Terms** | Keep standard technical terms and introduce them beside their definition or number. | *Arithmetic intensity: FLOP per byte* is useful. Coined labels that rename a known operation are not. |
| **R8. Experiment** | Use an imperative when the reader can test the claim: **Permute the rows. Hold the values fixed. Count the parameters.** | Replace a statement announcing an experiment with the experiment and its observable result. |
| **R9. Directness** | Name the actor and use an active verb. Remove scare quotes, filler, and *in this approach*. | Keep necessary uncertainty and conditions. Published quotations and technical string literals are not scare quotes. |
| **R10. Echo** | Read the last two sentences together. | Remove repeated words, conclusions, openings, and connectors, including repeated *so*. Inspect *every*, *never*, and *walks* for habitual rhythm. |
| **R11. Dash** | Write an ASCII spaced double hyphen, **` -- `**, when a prose dash is needed. | No prose U+2014, including examples. For a published quotation, preserve exact punctuation or explicitly label punctuation normalization; paraphrase when appropriate. |
| **R12. Numbers** | Compute each number and state its units, assumptions, and source when empirical. | Check what the calculation **proves**, including necessary versus sufficient conditions. A wrong number or false premise is a finding; repair dependent claims within scope and report the change. |

### Learning-centre renderer conflict

**Wave 1.x decision, accepted in the Wave 1.6 review on 2026-09-07:** avoid dash
constructions in new page prose. Use a period, comma, colon, or semicolon that
expresses the relation. Do not change the shared renderer to satisfy R11 in this pilot.

`src/lib/markdown.ts` converts authored ` -- ` to U+2014 outside code.
`src/lib/residual-markup.ts` reports a literal double hyphen in rendered prose as
unrendered markup. Thus authoring ASCII dashes does not deliver ASCII dashes, and
bypassing the renderer fails the page sweep. A clean source-character count alone
cannot establish the rendered punctuation.

R11 remains the owner's house preference; this is an explicit application boundary,
not a retraction. Leave canonical lesson prose and published quotations unchanged;
Wave 1.9 explicitly authorizes direct SVG prose repairs in the rendered figure set.
Use full sentences without dash constructions in those repairs. Any change to the shared renderer or
residual-markup rule needs a separate owner decision with its broader effects stated.

Name topic modules **Warmup**, **Tokens and embeddings**, **Attention**, **Feedforward layers**,
**Normalisation**, and **Output and sampling** when those are their contents. Do not turn the list
into obligatory *Why ...* headings or repeat *never* for emphasis. The owner rejected *the argument
that forces the component to exist* and *taken for X rather than Y*: both describe a reading pose
without teaching the component.

**On the current path and course, topic titles are the required output for module and lesson
titles**, including inherited titles. Rename the assigned titles now. Neighbouring titles outside
the edit scope are not a reason to retain the rejected pattern or ask the owner to make the same
decision again. Headings *inside* a lesson body are a different surface and take a finite verb;
see §5, rule 4.

For a short lesson introduction, use this order: **topic heading; concrete action or fact;
calculation or imperative experiment; result and any necessary boundary.** Stop when the reader
has the result. Add a content-named link only when it supplies something the passage does not.
Read adjacent fields as one passage: a `then:` field must add a calculation, experiment, or
boundary that the `why:` field has not already supplied.

The trailing boundary must be stated as a condition, not as a retraction: *holds below batch 32*
ends on the domain, *this does not measure a gated MLP's storage* ends on a negation and §7A
forbids it in that position.

A path summary follows the computation: **A decoder turns token IDs into vectors, combines
information across positions, and predicts the next token.** Continue with the actual learner
action. A count of steps or a promise of a *forcing argument* does not substitute for that content.

### Named tells

Inspect these as concrete editing failures, not evidence of who wrote a passage:

| Tell | Repair |
|---|---|
| Abstract noun as agent | Name the tensor, operation, device, or person doing the work. |
| Contrast as rhythm | State the fact directly; keep comparisons that distinguish real alternatives. |
| Fragment closers | Finish the action or calculation in a complete sentence. |
| Titular fragment | Replace a decorative noun phrase plus appositive tails with a topic label or an actor and finite verb. Read the complete title, not just a matched substring. |
| Saying it twice | Delete the restatement. |
| Pointing instead of delivering | Supply the result or a content-named link. |
| And where so belongs | Express the causal dependency. |
| Hedges, filler, passive | Name the actor and the necessary condition. |
| Word echo | Read adjacent sentences and remove repeated wording. |
| Statement where an experiment belongs | Give an imperative and its observable result. |
| Over-scrubbing | Restore the standard term beside its meaning. |
| Em dash as habitual punctuation | Use the owner's ASCII dash convention or clearer sentence structure. |
| Numbers as ornament | Compute the quantity and verify what it establishes. |

Read the [owner's worked examples and technical corrections](owner-examples.md) before applying
these rules. The owner's models control the style; an error in a submitted model still needs repair.

### Titular fragments: headings and figures are prose surfaces

The tell is a headline such as *X, done rather than named* or *the same X, this and that*:
a noun phrase with decorative appositive modifiers, presented as if it made a claim. Use
**Derivations** as a topic label, or **Normalisation placement changes the gradient bound**
as a complete statement. A technical panel label such as **LayerNorm** is a useful topic,
not a failed sentence. A verb alone is not enough: remove anthropomorphic causes such as
*the forward pass ignored them* and name the operation.

Read the surrounding claim before supplying the verb. **Not a bottleneck. Wasted.** in an
MLP rank diagram concerns representable functions, not runtime throughput. Its replacement
must preserve that subject: **The two projections can represent any square linear map.**
If the fragment alone does not identify its meaning, mark the context needed rather than
inventing a more fluent claim.

Test the construction, not the words. **Normalise the branch output rather than its input**
is a finite imperative making a real comparison; it is not this tell. **Schematic, not to
scale; the numbers are printed rather than plotted** is a required disclosure, not a
decorative heading. Keep the disclosure. R3 still budgets *rather than* at one per page;
this named tell does not create a substring ban.

**Coverage warning:** the corpus's figures had not been swept for these writing rules when
Wave 1.9 began. Earlier prose passes did not certify SVGs. A repaired pilot set is not a
corpus-wide certification. Collect every delivered figure ID, then read its `<text>` runs,
`<title>`, and `aria-label`, as well as the page's headings, captions and opened disclosures.
After each SVG edit, join the text runs and read the sentences: shortening one run must not
delete the clause continued by the next. Run both `rendersvg` and `figure-delivered.mjs` at
the delivered width, retaining their exit statuses. Geometry and label must still assert
the same claim.

**MEASURED HERE.** A sweep of the delivered surfaces of the two pilot lessons found **33 sites**
in five sub-patterns: `X, <participle> rather than Y` (8), an `X, <participle>...` tail (10), an
`A, B, C` comma triple (11), a bare `Not a X.` fragment (3), and one *because the ... ignored them*.
**Two thirds of the sites were inside SVG figure text**, not prose. An earlier style pass had
cleaned the prose and never opened a figure, and the owner found the survivors. The lesson is not
about this tell: a pass that certifies one surface has certified one surface.

### Superseded instructions

| Older statement | Current disposition |
|---|---|
| *Nothing in this file gates anything; everything is advisory.* | **Superseded for R1–R12.** The owner rules bind the edit. Older statistical screens remain advisory. No automated result replaces owner LGTM. |
| *Prefer a claim or a question over a topic label.* | **Superseded.** Use topic titles on the current path and course. Questions remain useful in exercises and explanatory prose. |
| G10: antithesis has *no number*. | **Superseded for the named phrase.** R3 permits at most one `rather than` per page. Other contrast patterns need editorial review; the quota is not a universal style statistic. |
| *A style pass may not change a digit.* | **Superseded by R12.** Calculate, report errors, and repair the claim. Preserve attributed quotation text or clearly distinguish correction from quotation. |
| *Hold graded strings fixed and restyle around them.* | **Superseded when a string grades a false claim.** Report the grading consequence and repair all authorized teaching and scoring surfaces together. Scope still limits what may be edited. |
| Dash-rate budgets and *count the construction, not the character*. | **Narrowed.** Construction counts help inspect rhythm; R11 independently requires ASCII ` -- ` in authored prose. |
| *Under 70% concrete subjects reads as fog*; unique headings prove quality. | **Withdrawn as gates.** Inspect the actor and navigation purpose. A percentage or varied heading cannot certify either. |
| §9's *choose the register deliberately*, read as choose one. | **Narrowed.** One register is right for an ordinary claim. The object the page exists to teach gets several, cross-linked; see §9A, which is bounded by R5's own second-representation clause. |

### Actual failed baseline

The owner reviewed `curriculum/llm-forward-pass-path.md` at commit
`081793cac5205b2a88eb2f7d72dd0768ec3f4cad`. A case-insensitive whole-word count of that
immutable file gives **8** `rather than`, **7** `every`, **2** `walks`, **2** `never`,
**3** U+2014 characters, and **12** `then:` fields. The field count describes the schema; it is
not a reason to delete required fields. This is the failed artifact, not a fabricated bad example.

It also called **1.2%** the expected squared overlap of random directions at width **7,168**.
For independent isotropic unit vectors, `E[(u·v)^2] = 1/d`, so the percentage is
`100/7168 = 0.013950892857...%`. The RMS dot product is `1/sqrt(d)`, or
`1.181138978...%`, which rounds to 1.2%. These are different statistics. A prose edit that
retains the wrong statistic has not passed R12.

Use a bounded fresh-context application on this baseline when a test agent is available. Inspect
what it actually writes, including numbers and preserved terms. A single successful application
is limited evidence about this task, not a general guarantee.

### Older evidence and advisory screens

Earlier reviews rejected an automated style standard: its checker missed encoded dashes, mistook
subjects, and could crash on short input. That limits the checker, not the owner's authority to
set house preferences. The older measurements below are retained as historical reports; their raw
corpora have not been remeasured for this revision.

Every rule carries one of five labels. Read the label before you obey the rule.

| label | meaning |
|---|---|
| **SOURCE** | the cited author states this |
| **INFERENCE** | derived from a source's mechanism; the source does not state it |
| **MEASURED HERE** | measured on a real corpus, with n and the corpus named |
| **HOUSE RULE** | a preference, held because it is held |
| **PROVISIONAL** | believed, unvalidated, and may be wrong |

Keep source evidence separate from house preference. An inference drawn from a source is not
something the source stated.

### The triggers

| # | Trigger | Threshold | Label |
|---|---|---|---|
| G1 | Dash constructions | historical screen: >6 per 1,000, or >2 in one sentence; R11 independently binds glyph choice | reported MEASURED HERE: sampled writers 3.6–5.2, sampled corpus 8.6–12.5 |
| G2 | Metadiscourse | review sentences whose subject is the document; signposts are used *sparingly*, per the source | principle SOURCE (Pinker); the subject classifier is INFERENCE |
| G3 | Headings repeated verbatim | review each repeat; structural navigation headings are a declared exception | HOUSE RULE |
| G4 | Stacked qualifiers | ≥2 on one claim, and trailing position | SOURCE (Williams) |
| G5 | Sentences > 45 words | **no failure number.** Review each; word count alone never fails one | PROVISIONAL |
| G6 | Subjects that hide an action | **no number.** An abstract subject is not a defect; it fails only if it hides an actor or a causal relation | PROVISIONAL |
| G7 | Words per explanatory surface | pilot target 400 for mechanism chapters; **report max gap, not mean** | MEASURED HERE |
| G8 | mechanism / alternatives / boundary | per load-bearing claim; not a heading template | HOUSE RULE |
| G9 | One canonical example, carried | 1 | HOUSE RULE |
| G10 | Antithesis constructions | older **no number** advice superseded by R3 for `rather than`; inspect other forms | HOUSE RULE for the quota |
| G11 | Emphasis density | **no number.** Measured defect is one mark per 58 words | PROVISIONAL |
| G12 | Cross-document rate spread | **report only. No threshold, and no authorship inference** | see §0.1 |

An earlier draft made G3 the one gate, on the reasoning that a generator satisfies a rate by
adjusting a rate but cannot satisfy a uniqueness constraint that way. That was refused too, and
fairly: uniqueness is as gameable as a rate by a generator told to vary headings, and the rule
rejects useful repeated navigation headings, which some documents legitimately want. It stays as
a trigger with a declared exception.

### 0.2 Completion note

A short review note is enough; do not create a second approval bureaucracy. Report:

| field | meaning |
|---|---|
| **reviewer** | a named person or agent, not "the gate" |
| **rules checked** | R1–R12, and any older screens actually used; name the measured artifact |
| **disposition** | changes, kept passages with reasons, and numerical findings with calculations |
| **owner decision** | pending or explicit LGTM; an agent's review cannot grant it |
| **what was not read** | surfaces, sizes or states the review did not cover |

An automated pass is not owner approval. R12 requires checking the claims touched by the edit;
that bounded check does not certify the truth of the whole document or its sources.

### Why G11 and G12 carry no number

Both were mine and both were **wrong in kind, not degree**.

**G11 had an inverted sign.** It read "≥ 1 emphasis mark per 150 words". The measured defect is
one mark every *58* words, which is too dense. A floor of one per 150 passes 58, passes one per
word, and fails only calm prose. The gate fired on the opposite of the defect it was built for.

**G12 claimed that unnaturally stable tic rates reveal a generator.** Three things kill it.

The two corpora are not independent evidence: they share the authoring process whose effect is
at issue, so this is one process observed twice, not a sample and a control. Low variance is
equally consistent with one careful author, a house style, a single genre, a shared template,
or documents already normalised by this very gate.

The statistic is mechanically length-dependent. Under a Poisson null where documents share one
true rate, population CV is `sqrt(1000 / (lambda * L))`. With `lambda = 10.57` occurrences per
1,000 words and `L` words per document, the recomputed values are:

| words/doc | expected CV from counting noise alone |
|---|---|
| 1,500 | **25.1%** |
| 3,000 | 17.8% |
| 4,800 | 14.0% |
| 10,000 | 9.7% |

The proposed 25% threshold is crossed by noise at 1,514 words per document, so the same
perfectly uniform process passes short documents and fails long ones. Worse, this corpus
reported 12.2% at ~4,800 words, below the model's 14.0% population CV. A sample CV can fall
below that value; it is not a noise floor or evidence of authorship. The proposed threshold has
no validated authorship interpretation.

And the incentive runs backwards. A gate rewarding variance lets an author score better by
making some documents more tic-heavy than others, which punishes the consistency a house style
exists to create.

**Report the spread. Do not infer authorship from it.**
### 0.1 Cross-document spread: report it, infer nothing from it

Measured two ways, because the answer depends on the instrument:

| set | n | dash rate range | mean | sd | sd/mean |
|---|---|---|---|---|---|
| chapters | 10 | 8.60 to 12.47 | 10.57 | 1.29 | 12.2% |
| sibling documents | 28 | 5.70 to 14.10 | 9.40 | 2.00 | 21.3% |

A second harness, stripping prose slightly differently, put the same two sets at 9.1% and 13.4%.

**Report these numbers. Draw no conclusion from them.** The refutation is in the section above:
the two sets share the authoring process whose effect would be at issue, the statistic is
mechanically length-dependent, and a gate rewarding spread would punish the consistency a house
style exists to create. The earlier description of a Poisson **noise floor** is withdrawn.

An earlier draft of this file read the low spread as a generator signature and told the reader
that more spread is more human. Both claims are withdrawn. They are recorded here because the
withdrawal is useful: a table of rates does not establish who wrote the text.


### Where the numbers came from

The two numeric thresholds that are easy to invent are G1 and G7, so both are set from
measurement rather than taste. Measured across Jalammar, Weng, colah and Distill:

| | words per figure |
|---|---|
| Jalammar (illustrated explainers) | **66 to 100** |
| colah | 130 to 166 |
| Weng | 135 to 327 |
| Distill (static floor) | 89 to 547 |

**400 was a pilot target, not a measured acceptance boundary.** The earlier claim that it sits
above all the reported observations was false: the Distill range reaches 547. Choose figures
that explain the mechanism and inspect the longest unsupported prose span.

On dashes: counting the *glyph* is the wrong instrument. Jalammar scores **0.00 em dashes per
1,000 words** and yet runs **3.6 to 5.2 dash constructions** per 1,000, among the highest measured,
because he writes the break with an en dash. Count constructions to inspect rhythm, and inspect
characters separately for R11. The reported range ends at 5.2; rounding it to five does not create
a validated boundary. The relation the punctuation expresses determines the edit.

### Retired invented thresholds

Provenance is labelled above for G1, G7 and G12, which came from measurement. That is backwards
from the reader's side: **the numbers that need a warning are the ones nobody measured.** These four
are mine, chosen, and unsupported by any corpus:

| gate | threshold | standing |
|---|---|---|
| G5 | 1 sentence over 45 words per 1,000 | invented |
| G6 | under 30% abstract subjects | invented, and see §2 for a worse problem with it |
| G10 | 15 antithesis constructions per 1,000 | invented |
| G11 | 1 emphasis mark per 150 words | invented |

Pullum measured sentence-initial *however* across three good writers and got **Twain 2.33, James
0.067, Stoker 0.2 per 1,000** -- a ratio of `2.33 / 0.067 = 34.776...` between the first two.
Those reports do not validate a universal budget. The retired thresholds stay retired; the owner's
R3 quota is a separate house constraint and cannot be waived by this comparison.

### What measurement removed from this list

Two suspicions did not survive contact with the corpus, and both were mine:

- The historical sample reported **82 hedges in 193,000 words**, or
  `82 / 193000 * 1000 = 0.42487...` per 1,000. That does not excuse filler in the current page.
- The historical scan found one verbatim repeated paragraph, a deliberate canonical-workload
  block. It did not measure paraphrased restatement, which R5 requires us to inspect.

Measure before you rewrite. Two of the five things I was confident about were wrong, and the
worst real tic (emphasis saturation, one mark every 58 words) was one I had not thought of.

---

## 1. Metadiscourse: the single highest-yield fix

Pinker's diagnosis, verbatim:

> "Thoughtless writers think they're doing the reader a favor by guiding her through the text with
> previews, summaries, and signposts. In reality, **metadiscourse is there to help the writer, not
> the reader**, since she has to put more work into understanding the signposts than she saves in
> seeing what they point to, like directions for a shortcut that take longer to figure out than the
> time the shortcut would save."

His rule is not "never signpost". It is:

> "The art of classic prose is to use signposts sparingly, as we do in conversation, and with a
> minimum of metadiscourse."

### Point at the subject

**Look at the grammatical subject of the sentence.**

- Subject is a piece of the document ("this chapter", "the preceding discussion", "the rest of this
  section", "what follows") → **metadiscourse. Cut or rewrite.**
- Subject is the subject matter, or "we" → **signpost. Keep.**

### The three rewrite operations

| op | before | after |
|---|---|---|
| **A. Announcement → question** | "This chapter discusses the factors that cause names to rise and fall in popularity" | "What makes a name rise and fall in popularity?" |
| **B. Text-reference → vision-reference** | "The preceding paragraph demonstrated that parents sometimes give a boy's name to a girl" | "As we have seen, parents sometimes give a boy's name to a girl" |
| **C. Delete** | "It is important to note that..." | (the sentence, without it) |

Operation A can remove an announcement inside a paragraph. **Its old use as the default heading
recipe is superseded.** Use topic names for the course modules; see §5.

---

## 2. Characters and actions: who does what

The Williams/Gopen rule, and the reason abstract prose feels like fog.

- **Put the character in the subject.** A person, a chip, a kernel, a number. Not "the utilisation",
  not "the consideration of", not "an analysis".
- **Put the action in the verb.** Not in a nominalization hanging off a weak verb.

### The nominalization scan

Search for `-ance`, `-ment`, `-ation`, `-ility`, `-ness`. For each hit, ask: is there a verb buried
here, and who is doing it?

```
before   The utilisation of the memory bus by decode is the determinant of throughput.
after    The GPU saturates the memory bus on this decode workload, so bandwidth caps throughput.
```

The GPU performs the action; the second clause states its consequence.

### Inspect subjects

Sample sentences from the page and identify who does what. The old **70%** cutoff is withdrawn.
Replace an abstract noun that hides an actor; retain a named technical object that actually performs
the operation. Do not turn *attention* or *softmax* into circumlocutions to satisfy a noun classifier.

---

## 3. Dash punctuation

R11 requires ASCII ` -- ` in authored prose. The historical punctuation argument below helps
choose the relation; it does not prove anything about an author's identity.

**Unresolved and open. [PROVISIONAL.]** In the learning centre the glyph rule and the renderer
contradict each other: `src/lib/markdown.ts` converts authored ` -- ` to U+2014, and the
residual-markup sweep fails on a literal `--` that survives to the rendered page. So authoring the
owner's dash does not deliver it, and bypassing the renderer fails the sweep. Authors have been
avoiding dash constructions altogether, which is a workaround and not a decision. §0 records the
application boundary. Changing the renderer or the sweep needs a separate owner decision.

Gopen & Swan, on where a reader lands emphasis:

> "The stress position coincides with the moment of syntactic closure."

And on which punctuation creates a *secondary* stress position mid-sentence:

> "Within a sentence, secondary stress positions can be formed by the appearance of a properly used
> **colon or semicolon**; by grammatical convention, the material preceding these punctuation marks
> must be able to stand by itself as a complete sentence. Thus, sentences can be extended
> effortlessly to dozens of words, as long as there is a medial syntactic closure for every piece of
> new, stress-worthy information along the way."

**The comma and the em dash are not on that list.** [SOURCE, for the list itself.]

What follows is narrower than it looks, and the first draft of this file got it wrong.
[INFERENCE, corrected.] A dash does not require the material before it to stand as an
independent clause, so unlike a colon or semicolon it does not *guarantee* syntactic closure.
It does **not** follow that a dash creates no emphasis. Syntactic closure is not the only
source of prominence in a sentence, and Gopen and Swan never claim it is. They never discuss
dashes at all: the word does not occur in their text. Three independent readers checked.

So the usable form is a question, not a verdict:

> **Would a colon or a semicolon expose the relation better here?**

Often it would, because the relation a dash carries is unspecified and the reader has to infer
it. Sometimes it would not, and forcing the substitution produces punctuation that is
semantically wrong. Inspect each instance.

### The rule

Use a colon to introduce a result after a complete clause. Use a semicolon between related
independent clauses. An ASCII dash can mark an interruption or a short definition, as in the
owner's equivariance example. The old **interruption-only** rule is narrowed by that example.

### Classify before you fix

Take each dash and name which it is:

| kind | fix |
|---|---|
| a colon that lost its nerve | **→ colon** |
| an appositive definition | **→ comma pair, or a separate sentence** |
| a comma splice being dodged | **→ semicolon, or split** |
| parenthetical aside | **→ parentheses, or cut it** |
| genuine interruption | **keep** |

Choose punctuation that expresses the relation. A colon is not interchangeable with a dash
following an incomplete clause.

### Historical screen

The old **five per 1,000 words** screen was a rounded observation, not a quota or target.
Long sentences can work when the reader can resolve each clause. R11 governs the glyph even
when the rate is low.

Treat the number as a screen that tells you where to look. The classification above is what decides
whether a given dash is a defect, and a dash that should have been a colon is a defect at any rate.

---

## 4. Hedging

Pinker's sequence: **hedge → qualify → quantify.**

- **Hedge**: inspect "roughly", "somewhat", "arguably", "tends to", "more or less", "essentially",
  "effectively", and "in some sense". Delete empty protection; keep a warranted approximation
  attached to the calculation or measurement that requires it.
- **Qualify**: name the actual condition. "Below batch 32." "On this workload." "At fixed head
  dimension."
- **Quantify**: give a computed or sourced number when it adds information. False precision
  violates R12.

### Ask what breaks

> **What becomes false if I delete this word?**

Nothing → delete it. Something → say what, and you have just written the qualification. A number is
available → use the number.

Remove stacked hedges that make no distinct qualification. Two independently necessary bounds
are not filler.

```
before  This roughly tends to be somewhat faster in most cases.
after   On the measured workload, the kernel takes 10 ms instead of 19 ms: a 1.9x speedup.
```

These timings are an illustrative input, not a hardware measurement. Check the calculation
`19 / 10 = 1.9` before using the comparison.

---

## 5. Headings

A heading is an index entry. It earns its line by telling the reader something about **the subject**
that distinguishes this section from every other section.

### Four rules for headings

1. **Name the topic.** Warmup, Tokens and embeddings, Attention scores, and Feedforward layers
   tell readers what they will study. Repeated navigation labels can be useful.
2. **Use topic titles on the current path and course.** The old *prefer a claim or a question
   over a topic label* rule is superseded. Put the question in the exercise or explanation;
   retaining an inherited Why series does not satisfy this rule.
3. **A heading is not a promise to restate it.** The paragraph under it must not open by saying the
   heading again in sentence form.
4. **A module title and an in-body section heading are different surfaces.** Rule 2 governs module
   and lesson titles, which are navigation. A heading *inside* a lesson body names a claim: give it
   a finite verb and no negation marker. A bare noun heading lost 4 of 5 cold readers when the
   section under it never defined the noun (`Activation`). A finite verb is necessary and not
   sufficient: `ReLU changes the functions an expanded layer can represent` has one and still
   failed, because it names neither side of the change. [MEASURED HERE, n = 5 cold readers on one
   delivered lesson; the rule itself is HOUSE RULE. See §6A.]

### Worked, from a real corpus

| before | after |
|---|---|
| `Why the model never sees text` | `Tokenisation` |
| `Why position is added deliberately` | `Position and causal masking` |
| `Why a block has two sublayers and not one` | `Feedforward layers and gating` |

The old guide praised novel Why headings as the repair for repeated boilerplate. The owner
rejected the resulting cadence. Preserve stable anchors and schema fields while editing their
visible prose; variation for its own sake does not help navigation.

---

## 6. Organisation: top-down, with one canonical example

### Top-down

Give the whole shape early, then refine. The reader should be able to stop after 10% and still have
a correct, coarse model.

- **Open on the phenomenon.** Name what the tensor, model, device, or relevant person does.
  A researcher is the right actor when the sentence makes an attribution.
- **The organising figure or the organising claim goes near the front.** If the one picture that
  makes the document make sense sits at 86% of the file, the document has no shape.
- **Old before new, with both halves selected.** [SOURCE, but only in its qualified form.]
  Gopen and Swan explicitly reject the bare "old before new" rule, because the bare form is
  unsatisfiable: *"No such rule is possible."* Their actual rule selects **the old information
  that links backward** for the topic position and **the new information you want the reader to
  emphasise** for the stress position. Both halves are selection criteria and both need
  judgement. Dropping them, as the first draft of this file did, turns a real rule into a
  slogan. Extending it to paragraph scale is [INFERENCE] and mine.

### One canonical example, carried

Pick one concrete instance and carry it through the entire document. Real numbers, named hardware,
a declared workload. Every abstraction gets instantiated against it.

Re-deriving a fresh example per section is the single biggest readability loss in technical writing,
because the reader pays the setup cost repeatedly and can never accumulate intuition.

**Declare it once, in a fixed place, and refer back to it by name.**

### Depth without loss

Never skip a step to save space. If a derivation has six steps, show six. Use a fold or an appendix
for the parts most readers skip, but do not delete them: the reader who needs step 4 is exactly the
reader the document is for.

---

## 6A. Page shape: teach the page, do not state it

The owner, on a page whose prose he had just called much better:

> "I cannot understand what this page is trying to teach. Every page must include context, build
> intuition with every section, have take aways at the end tying the the bigger picture... I have
> learned zilch after spending 15 minutes on this page."

**The measurement that makes this actionable, and it is the strongest finding of the campaign
[MEASURED HERE, n = 5 cold readers of five declared backgrounds, delivered text of one lesson]:
all five stated the MECHANISM and none stated the PURPOSE.** Every one reproduced the page's
derivations unaided and said so. On a page titled *Feedforward layers and gating*, not one could
say what gating is for.

> "I finished it knowing gating's shape and its price and not its purpose."
>
> "I assembled that sentence myself out of four sections that the page never joins."

Prose quality and teaching are independent. No count in this file detects this defect; §12 has the
instrument that does.

### Page shape

| # | element | budget | binding constraint |
|---|---|---|---|
| 1 | **Orientation** | ≤120 words, the first prose on the page, before any figure, equation, table or margin note | name the previous step and say what changed; one sentence of division of labour, positive on both sides; the stakes as a number the reader will meet again; no negation, no undefined term, no forward reference |
| 2 | **The arc** | ≤80 words | the questions this page settles and the order it settles them in, ending with what the reader will be able to derive |
| 3 | **First figure** | after 1 and 2, never before | readable with element 1 alone; its drawn text, title, subtitle and caption are delivered surfaces and every rule here binds them |
| 4 | **Body sections** | ~4,000 words | each obeys the section shape below; no derivation, worked example, truth table or figure appears twice |
| 5 | **Borrowed vocabulary** | one short block, before the first section that computes with another lesson's concepts | one sentence per borrowed noun, or an explicit deferral with a link that resolves |
| 6 | **Named-model section** | -- | every number carries its arithmetic and, where available, an independent cross-check |
| 7 | **Cost and alternatives** | -- | benefit before price, always. Cost with no benefit is not a trade-off, it is a bill |
| 8 | **Carry / takeaways** | 200-350 words, mandatory | the rule in one sentence; three to five results the reader can derive on demand; the trade-offs at a line each; what the reader should refuse to say; the bridge. Each is written to be said out loud under questioning, per §0's spoken-defence standard |
| 9 | **The bridge** | the last sentence | names the next step and why this page forces it; not a negation, not a new topic, not a retraction |

**Element 8 is measured absent.** Zero headings match `take-?away|summary|recap|what you|in short`
in either measured lesson. I re-ran that pattern over both delivered texts and confirmed zero, in
the whole file rather than only its headings. [MEASURED HERE, n = 2 lessons.]

**A page can contain its own conclusion and never assemble it.** The best takeaway on the measured
page was named by 3 of 5 readers as the most useful sentence on it, and it was drawn text inside
Figure 4 at 88% depth. Assembly was the missing work, not authorship. This is §6's organising
figure at 86% again: the material exists and it is filed where nobody reads it.

### Section shape

Every section, in this order:

1. A heading with a finite verb and no negation (§5, rule 4).
2. **One concrete anchor before any general statement** -- a picture, a number, or a worked
   instance the reader can hold. 5/5 readers named the same schematic as the thing that carried
   them; one said he understood the shape in twenty seconds. Abstraction after the anchor lands.
   Before it, it does not.
3. **The positive statement of what the thing is and what it is for, before any formula, cost,
   comparison or caveat.** This is the element whose absence produced the owner's verdict: the
   entire conceptual content of the page's title topic was one subordinate clause, against a full
   section of cost arithmetic.
4. The mechanism or derivation, in full, with the arithmetic shown. This part of the measured page
   worked and needed no change.
5. At most one caveat, followed by a positive sentence (§7A).
6. One sentence of consequence tying the section to the page's thesis.

### When the sources do not answer "what is this for"

**Say that they do not.** [HOUSE RULE, and it is the honest position.] No source in the library
explains why gating helps; the gain is empirical and unexplained in the literature held. Three of
five readers said an explicit *the gain is measured and unexplained* was a fact they could carry,
and that the silence read as something they had missed.

Say what the thing does, what it costs, and that the reason it wins is measured rather than derived.
Taking the plausible route instead is how this corpus has shipped false field claims. R12 and §7's
*Absolutes* govern the repair; §12's *Test the inference too* is the check.

**A provenance marker aimed at reviewers is read by learners.** An unsourced-claim marker rendered
as `MADE UP STUFF` in shouting capitals, inside the sentence that supplied the denominator for
every percentage on the page. **4 of 5 readers withdrew trust from surrounding numbers that were
correctly sourced**, and none could tell a house convention from a leaked placeholder.
[MEASURED HERE, n = 5.] The principle -- a visible gap beats a silent invention -- is right; its
rendering was doing the damage. Either ship the audit or state the limit in the register of the
rest of the page.

---

## 6B. Introducing a term

The owner: *"SiLU? What's SiTU?"* and *"Why use affine so often? Is it common in technical DL / ML
material? And the 'X removes B' is so indirect."*

**Verify the term before you file the bug.** `SiTU-GLU` is not a typo. It is the activation named
in the *Activation Function* row of the Kimi K3 model card (ledger key `kimi2026k3card`,
`sources/cache/57de265b5842dfa4.txt:119`), and it occurs **15 times over 14 lines** in the K3
technical report (`kimi2026k3report`, `sources/cache/86fb82a63ced501f.txt`): case-sensitive, hyphen
required, so `situation` cannot match it. The defect is that the lesson never expands it. Filed as a
spelling correction, that near-miss would have deleted a correct technical name.

Both halves of that check were themselves contested, which is the more useful lesson. A reviewer
re-ran it, reported the report absent from the cache and the term occurring exactly once, and
offered a cause: that the 15 came from matching `situation`/`situated`. The cause was plausible and
wrong, because the literal contains `-GLU`. **A correction needs the same evidence standard as the
claim it corrects**, and a wrong probe that arrives with a causal story is more dangerous than one
that just returns a number: the story is what makes it convincing.

**The probe could not read the file, and said so in three different ways, one of them silent.**
That report extract keeps PDF ligatures and 4,666 NUL bytes, so `file` calls it *data*. Measured on
this box: `grep` without `-a` prints nothing and exits 1; `rg` given the path directly returns 14
lines; and **`rg` walking the containing directory omits the file entirely, with exit 0 and no
warning on stdout or stderr.** The third is the dangerous one, because there is no diagnostic to
miss and the surviving output looks like a complete result. `grep -a` or `rg --text` recovers all
15. See §12.

**An introduction is a sentence that (a) expands every acronym in full, (b) says what the thing is
or does using a finite verb, and (c) does not begin with a negation.** [HOUSE RULE.]

- *"SiTU-GLU is K3's activation: SwiGLU with both branches passed through a smooth cap"* passes.
- *"Its SiTU caps are omitted here"* fails (b) and (c).
- `sigmoid tanh unit GLU` as a citation section label fails (b). A label is not a sentence.

**The introduction lives inline, in the same block as first use or the one immediately after. That
is the only permitted first home.** A margin note, fold, disclosure, `aria-label`, citation label
or table cell may *elaborate* a term already introduced; it may never be the introduction.
Evidence: **4 of 5 readers stopped opening margin notes entirely**, two naming the index at which
they quit. [MEASURED HERE, n = 5.] A glossary is a permitted second home and never the first.

**Deferral** is the alternative: a clause at first use naming where the term is defined, with a
target that resolves. Bound it, or a page has no vocabulary, only promises.

**One canonical name per concept.** Every alias is either absent from the file or introduced once,
at the canonical's introduction, as *also called X*.

### Worked failures, from the measured lesson

| term | readers | the defect |
|---|---|---|
| `decode ledger` | 5/5, none could infer | supplies the denominator for every percentage on the page; never named, linked, or described |
| `SiTU-GLU` | 5/5 flagged, plus the owner | real activation, used 15 times in the source report; never expanded in a sentence anywhere on the lesson page. Its single expansion there sits inside a citation label |
| `GLU` | 5/5 flagged, 4/5 could not infer | appears only welded into SwiGLU and SiTU-GLU. The string *gated linear unit* occurred zero times in the measured lesson, margin notes and figure text included |
| `m` / `d_ff` / `intermediate_size` / "hidden features" | 5/5 flagged; all five *could* infer it | one quantity, four names. All five reported losing time confirming the symbols name one number, and the figures use one set while the prose uses the other, so the page's cleanest result is stated in symbols the surrounding text never uses. An alias defect costs time rather than comprehension, which is why no reader reports it as a blocker |
| `expert` / `routed expert` / `MoE` | 4/5 could not infer | arrives in a subordinate clause, then carries a third of the page's arithmetic |
| `MXFP4` | 5/5 flagged, 3/5 could not infer | 4.25 bits per weight given without the format |
| `channel mixing` | 4/5 flagged | introduced at 82% depth as a new name for what 800 lines had called feedforward, then used as a bar label beside one reading *feed-forward* |

The fifth reader already knew MoE, which is the diagnostic: this rule is invisible to a reader who
holds the vocabulary, and that is every author.

---

## 7. Mechanism, alternatives, and boundary

A load-bearing claim needs its mechanism, relevant alternatives, and domain of validity.
These are questions to answer in the explanation, **not mandatory headings**. A dimension chosen
by an author need not have been mathematically forced; state a design choice as a design choice.

| debt | what it answers | failure if skipped |
|---|---|---|
| **Why this** | what the mechanism establishes, and what remains a choice | the reader memorises instead of understanding |
| **Why not the alternatives** | what the other options were and what specifically kills each | the reader cannot tell a law from a convention |
| **What else / when does it stop** | the domain, the crossover, the regime where it flips | the reader over-applies it, which is worse than not knowing it |

### The third one is the one everybody skips

An unbounded claim gets misapplied. State the boundary:

- "Quadratic in S **at fixed head dimension and fixed on-chip capacity**."
- "Faster **below batch 32**."
- "Theorem 2 holds on the domain d_h ≤ M ≤ S·d_h **and does not extend past the endpoint**."

### Absolutes

When correcting an over-strong claim, establish the actual domain. The answer may be a threshold,
an algebraic condition, or a counterexample. Keep a necessary universal or negation; remove
*every* and *never* when they merely add drama.

§7A governs where a boundary goes on the page. A boundary the reader has trained themself to skip
has not been delivered.

---

## 7A. Negation, contrast, and where a caveat goes

The owner: *"'The left map omits activation and biases. The right example uses hand-set weights to
compute XOR.' not the best way to establish contrast. Tell what it does but shoving what it doesn't
do, in there."*

### The measurement

| what was counted | result | label |
|---|---|---|
| body sentences carrying a negation marker, delivered text of one lesson | **37 of 232**, about one in six | MEASURED HERE |
| negation-shaped sentences, same lesson, different sentence split | 47 of ~495, about one in ten | MEASURED HERE, five cold readers counting independently |
| "fencing" sentences per body word | 36 in 3,974, one per 110 | MEASURED HERE, same instrument |
| negative-framed titles and labels, delivered surfaces of two lessons | **27 found** | **census, no denominator** |

The two sentence splits disagree because they split differently. Both land in the same order of
magnitude and neither is the true number; the finding is the rate, not the digit.

**The 27 is not a rate and must not be read as one.** Nobody counted how many titles and labels
those two lessons deliver in total, so 27 supports "there are at least 27 of these, here is where
they are" and nothing about density. A later sweep that finds 31 has not found a regression. If you
want a rate from this row, count the denominator first.

### The consequence, which is the part worth writing down

**Negations cluster at the ends of sections and captions.** Two of five readers independently
reported, in nearly the same words, that they had trained themselves to **stop reading the second
half of every paragraph.** [PROVISIONAL: self-report from synthetic readers, n = 5.] The
load-bearing caveats were then skipped along with the boundary maintenance, including the one a
reader called the single most professionally useful sentence on the page. That is the mechanism by
which an honest page teaches nothing.

### The rules

**Placement. [HOUSE RULE.]** At most one caveat per section. It must be *followed* by a positive
sentence, not preceded by one. No section, caption or page may terminate on a negation. A caveat
that cannot take that shape moves to the margin (§8A) or into the *what you should refuse to say*
block in the takeaways (§6A), where the reader already holds the positive claim being fenced.

**Contrast. [HOUSE RULE, derived here.]** Establish a contrast positively: **name what each side
does, in a finite verb, before naming what either side lacks.** A difference stated as an absence
makes the reader reconstruct the present case out of the missing one.

```
before  The left map omits activation and biases. The right example uses hand-set weights
        to compute XOR.
after   The left map applies two linear projections in sequence, so it computes one linear
        map; it carries no activation and no biases. The right map puts ReLU between them,
        and hand-set weights then compute XOR. The nonlinearity is what buys that.
```

The omission survives. It is subordinated to the positive statement and it is not the last thing on
the page.

**This does not license cutting caveats.** Two of five readers defended specific negations by name.
Keep every one and move it. R3's `rather than` quota and §10's antithesis note are about rhythm;
this rule is about position, and the two are independent.

### Provenance of the contrast rule

Asked for a contrast rule, the reader synthesis returned the literal string
`"See the contrastRule field."` -- a self-reference where the rule belonged. The rule above is mine,
derived from the owner's comment and the placement measurement. It has never been tested on a page.

---

## 7B. Kinds of intuition

The owner, on pages whose prose he had already accepted:

> "I am begging to include more color, and visual pleasure, and geometric and more types of
> intuition. That's something lacking even now."

*Add intuition* is not an instruction anybody can follow, and an author who tries writes another
paragraph of the same kind they already wrote. A list of **kinds** is followable, because each names
a different question and each has a visible failure when it is missing.

| kind | the question it answers | done, it looks like |
|---|---|---|
| **geometric / vector-space** | what does this do to a vector, a direction, an angle, a subspace, a rank? | the operation named as a motion: projects onto, rotates within, collapses a rank, leaves this subspace fixed |
| **dimensional** | what are the shapes, and which axis is being consumed? | every tensor's shape carried through the operation, with the contracted axis named |
| **limiting cases** | what does this become at 0, at 1, at infinity? | the object evaluated at the endpoints, including the endpoint where it degenerates |
| **physical / cost** | what does the hardware actually do, and what does it cost? | bytes moved, FLOP counted, the time that follows, on the canonical example |
| **counterfactual** | remove the component; what breaks, precisely? | a named consequence: this exact function becomes unrepresentable, never "the model gets worse" |
| **historical** | what could the previous design not do? | the earlier design's specific failure, which is the reason this one exists |
| **analogical** | what already-held thing does this behave like? | the mapping *and* the place it breaks, in the same breath |

**The rule. [HOUSE RULE.] A load-bearing claim gets at least two of these kinds, and one of them is
geometric wherever a vector, matrix or subspace is involved.** Two is the floor because one kind of
seeing is indistinguishable from the claim itself restated; the geometric requirement is the owner's,
named in the sentence above, and it is the kind this corpus most often omits.

**This is not §7 again.** §7's three debts state the claim's *status*: what the mechanism forces,
what the alternatives were, where it stops holding. These state how the reader *sees* it. A claim
can carry all three debts and remain invisible, which is exactly the page §6A measured: five of five
readers reproduced its derivations and none could say what the component was for.

**Analogy carries a standing warning.** An analogy that breaks silently is worse than none, because
the reader keeps applying it past the break and has no way to notice. Name the break in the same
sentence, or use a different kind.

**Counterfactual is not a fourth-choice technique here.** This corpus already has an instrument built
on it: `docs/information-architecture.md` states *"Counterfactual is claim attack"*, and claim attack
is the assessment the reader is measured with. A page that never says what breaks when the component
is removed has not prepared the reader for how they will be examined.

**Do not stack all seven.** Each kind costs the reader a context switch, and §6A's section shape has
room for one anchor, the mechanism, and one consequence. Choose the two the specific claim makes
vivid. §9A governs the related and distinct case: one object shown in several registers, with the
registers pointing at each other.

---

## 8. Visual richness

This section is about whether a figure is **true**: whether it is dense enough, whether its caption
argues, whether every surface says the same thing. Whether a figure **belongs** to the page it sits
on is §8B, and the colour available to it is §8C.

### Density

The old **one figure per 2,000 words** floor was an unvalidated house suggestion, separate from
the 400-word pilot above. Neither is an acceptance gate. Draw a figure where geometry or a
comparison needs one; report long spans that lack a worked explanation.

### Measure, type size, and visual density are one setting

The owner: *"The look is pretty dry. Did you do any UX research? And render it and check it for
yourself?"* and later *"The width of the content is too small. The font is larger than I'm used to.
Zero visuals."*

[MEASURED HERE, by rendering the reference sites he named.]

| site | prose measure | body size | figure track | visual density |
|---|---|---|---|---|
| Thinking Machines | 660px | 17px | 800px | one visual per 192 words |
| Aleksa Gordić | 800px | 16px | -- | one image per 106 words |
| ours, at the time of the complaint | 640px | 19px | -- | **zero** |

Ours was **narrower and larger than both**, which is the combination that reads as a wall. (The
lesson geometry was widened afterwards; §8A's table records the later state, 700px at 17px.)

**None of these three numbers is a gate**, and the density column especially is not: it is what two
sites the owner named happen to do, in the same sense as the words-per-figure table in §0. Zero
visuals is the finding. 192 is not a target.

- **A reading measure and a type size are a pair, not two choices.** A narrow measure under a large
  face gives few words per line and a page of stubs. Neither number is a target on its own.
- **Figures and tables belong on a wider track than the prose.**
- **A figure is only known good at the widths something has actually measured it at.** Delivering an
  SVG authored at `viewBox="0 0 760"` at 800px produced geometric defects in **22 figures** while
  the file-level checker reported all of them clean. Author and check at the delivery width; §0's
  coverage warning has the tooling and its exit statuses.

### Captions carry argument

A caption that says "Figure 3: throughput vs batch size" is a wasted surface. The caption should
state what the figure shows you that the prose cannot, including the numbers.

- **A numbered caption earns its number by letting the prose point at it.** *"In the gated row of
  Figure 1..."* is what the number is for. A number nothing refers to is decoration.
- **Annotation belongs where the reader's eye is.** The best-regarded reference put handwritten
  commentary in the figure's own margins with arrows into the drawing. Inside the `viewBox` that
  fights the geometry gates; the form that survives them is an HTML annotation layer anchored to
  figure coordinates, which keeps the words off the drawing's geometry and still lands them on it.

### The figure must be checkable

- Label the axes with units.
- Put the real constants on the drawing.
- If a line encodes a relation, declare the relation. If it does not, declare that too.
- The `aria-label` carries the same argument as the drawn text. **A figure that says two different
  things to two readers is a defect, not an accessibility nicety.**

### Every surface carries the claim

When a claim changes, it changes on **all** of: prose, caption, figure text, `aria-label`, any
summary line, any derived instrument. Repairing one is not repairing the claim.

---

## 8A. Margins and secondary columns

The owner's test, and it is the rule: *"If it is fixed, why can't it be on the left? The right
margin must be relevant to the main text in focus."*

**Generalised: if a secondary column does not change as the reader moves, it is navigation and
belongs with the navigation.** [HOUSE RULE. The measurement below says the field agrees.]

### Measured: 20 sites rendered, 15 with a real margin

| site | prose | margin | gap | body | note | note/body | note count |
|---|---|---|---|---|---|---|---|
| HF smol playbook | 664 | 260 | 32 | 16 | 14.4 | 90% | 72 |
| Thinking Machines, on-policy distillation | 660 | 275 | 64 | 17 | 14.4 | 85% | 46 |
| nanotron ultrascale | 704 | 152 | 32 | 16 | 12 | 75% | 44 |
| Thinking Machines, LoRA | 660 | 275 | 64 | 17 | 14.4 | 85% | 28 |
| rstudio/tufte | 770 | 385 | 77 | 21 | 16.5 | 79% | 21 |
| Ink & Switch, local-first | 616 | 168 | 80 | 16 | 13 | 81% | 19 |
| Crafting Interpreters | 576 | 288 | 48 | 16 | 14 | 88% | 19 |
| Quarto gallery | 799 | 301 | 25.5 | 17 | 14.025 | 82% | 16 |
| Distill, GNN intro | 704 | 152 | 32 | 16.96 | 12 | 71% | 13 |
| **Stripe API docs** (the one sticky case) | 583 | 583 | 42 | 14 | 14 | 100% | 13 |
| tufte-css | 770 | 385 | 77 | 21 | 16.5 | 79% | 7 |
| Distill, building blocks | 704 | 152 | 32 | 16.96 | 13 | 77% | 3 |
| ar5iv | 832 | 300.8 | 25.6 | 16 | 13.6 | 85% | 2 |
| gwern | 895 | 237 | 64 | 20 | 17 | 85% | 1 |
| mystmd | 744 | 336 | 16 | 16 | 14 | 88% | 1 |
| **ours** | 700 | 208 | -- | 17 | 11.8 | **69%** | **3** |

**14 of the 15 are anchored-flowing**: the note's document top is invariant and its viewport top
moves exactly -1px per +1px of scroll. The single sticky exception is Stripe, whose "margin" is
583px against a 583px prose column at the body's own size, which is a split pane and not a margin.
(The spec's own prose says 10 of 11; its table lists 15 and is the measurement.)

**The bands.** Note size runs **71% to 90% of body** on every site with a real margin; Stripe's
100% is the split-pane case. Ours was 69%, under the floor. On note count, the spec's declared
failure case is Distill/building-blocks at **3 notes and 1.5% fill**, whose own verdict is that
shipping a margin at that density is the defect; its declared working population starts at 13
notes and 6.6% fill and runs to 72. **Ours was 3.** We shipped the measured failure case rather
than something below it.

### The mechanism finding, which is the transferable one

**A grid-placed note can only align to a block, so it lands beside the paragraph rather than beside
the sentence.** Quarto's first note lands 131px -- five lines -- above its own marker, and its
second lands above its own paragraph entirely. A note emitted as a float at the marker's character
position lands on the line box of the sentence that summoned it, with no JavaScript, no `top`
calculation, no observer and no scheduling to get wrong.

### What goes in it, in rank order

1. **A source at the point of claim.** The default and the majority wherever it was measured: 28 of
   46 notes on one site, 21 of 28 on another. Full title as the link text.
2. **The extracted quote itself**, when the stored text is the evidence and inlining it would break
   the sentence.
3. **A pointer into another source's internals** -- *see Figure S1 of X for the sampling
   experiment*. The cheapest high-value type when the ledger already holds verified locators.
4. **A scope fence**: what this paragraph deliberately omits. Where §7A's displaced caveats land.
5. **Numeric provenance** for a constant the body states flatly.
6. **A derivation the body asserts without proof**, inline symbols only.
7. **A correction or counter-evidence from the field.** The type that makes the column worth
   reading, and the one that most needs a ledger entry, because it contradicts something.
8. **Terminology and notation fixes.** Contested; see the unresolved choice below. §6B forbids a
   margin note from carrying a term's *first* definition either way.
9. **A practitioner aside.** Legal without a ledger entry only while it asserts no checkable fact.
   The moment it makes a claim it needs an entry or it renders as invented. Keep it the minority.
10. **Supply is the union of the lesson's ledger entries and those of the steps it summarises.**
    Measured: one lesson's body carries 15 quotes / 5 sources against its steps' 32 / 11; another
    2 / 1 against 16 / 8. Body-only supply gives the second lesson two notes and a dead column. A
    harvested entry with no claim to attach to stays in the step.
11. **Excluded by construction:** figure captions, anything needing its own math line, anything over
    nine rendered lines, and any note whose marker does not sit inside a `<p>`.

### Rejected, each with the measurement that killed it

| technique | what killed it |
|---|---|
| Marker-free adjacency | binds to a block, not a claim; five sites degrade the same way |
| Grid-track auto-placement as the *anchor* | its resolution is the grid row: 131px off its own marker. Keep the grid for reservation |
| `height:0` plus absolute placement | no collision arbitration; notes in adjacent paragraphs overlap by 85px and overprint |
| JS position-once in document coordinates | measured stale by up to 841px in 2 of 11 loads. Late-layout figures and math have no safe scheduling |
| Sticky per-section columns | passes the change-test, fails subordination: prose width, body size, no binding to any sentence |
| Hover popups | occlude the summoning sentence (panel width equals prose width) and are unreachable by keyboard or touch |
| Figure captions in the margin | needs a second visual register to stay distinguishable from notes |
| A hard viewport gate on the apparatus | at 1600px, the most common desktop width, the reference page *about* sidenotes shows almost none of its own |
| Mid-paragraph checkbox disclosure at narrow | splits the paragraph in half at exactly the moment the reader asked for more detail |
| An ancestor `overflow:hidden` over the note track | absorbs 276px of off-screen note while `scrollWidth == innerWidth` reports clean |
| A decorative register: box, tint, italic, grey, sans | no measured page that reads as apparatus does any of it. Differentiate by size alone |

### Unresolved, and it should stay unresolved

**Note length.** gwern runs 6 long digressions across a 54,000px page in a column that grows with
the viewport; Thinking Machines runs 46 short notes, median 13 words, capped at 9 lines, in a fixed
275px column. Both work, in opposite regimes. Which one a document is depends on what its ledger
harvest actually returns, and that is not a style question. The spec refused to resolve it and was
right to; do not smooth it into a preference.

### Two check-design lessons from the survey

These are not layout lessons. They are about instruments.

- **A clean overflow number can mean the content was clipped, not that it fits.** An ancestor
  `overflow:hidden` absorbed 276px of note and `scrollWidth == innerWidth` still reported clean
  while every note on the page was off-screen and unreachable. Hit-test a text rect instead: take
  the first rect from `Range.selectNodeContents(note)` and test its centre. The box centre lies too,
  because it can land inside the note's own leading.
- **A set-based test cannot classify a page with one note.** gwern's page gates its whole sidenote
  apparatus at 1761px, so at 1600px the page *about* sidenotes demonstrates almost none of them,
  and the visible-note set is then identical at every scroll offset -- which a set comparison calls
  static. (The spec says zero notes in one place and exactly one in another; the conflict is
  unresolved and does not change the lesson.) The gate is the delta: document top invariant,
  viewport top moving -1px per +1px of scroll, sampled at four or more offsets. The set test is a
  screening heuristic that happens to agree with the gate on every page big enough to disagree.

---

## 8B. The figure that reads as pasted on

The owner, on pages whose prose he had already signed off:

> "Super plain pages with 'stuck on' pictures that look out of place (aesthetically, not
> contextually)."

**"Aesthetically, not contextually" is the whole diagnosis**, and it names a property this file had
no words for. The figures are correct, sourced, gated at two widths and two device pixel ratios, and
placed where the argument needs them. §8 asks whether a figure is *true*. Belonging is a separate
property with separate evidence: a figure belongs to its page when it shares the page's **typeface,
type scale, palette, surface, ink and stroke**. Each of those is a value the page already declares,
so each is read off the two files rather than argued about.

### Measured: four axes miss, one holds, one has nothing to bind to

[MEASURED HERE, 2026-09-08, read-only over `figures/**/*.svg` (n = 290) against
`src/lib/theme-tokens.ts` and `src/app/globals.css` in the learning centre. Every probe ran with a
term known present, in the same command over the same paths, per §12's control-term rule.]

| axis | the page declares | the 290 figures paint |
|---|---|---|
| **typeface** | three loaded faces: Literata for prose, Inter for UI, JetBrains Mono for code | 290 of 290 declare `ui-sans-serif, -apple-system, 'Segoe UI', sans-serif`; 40 also declare a `ui-monospace` stack. **No figure ever renders a face the page loads.** Three name JetBrains Mono second, behind `ui-monospace`, which resolves first |
| **type scale** | seven steps: 11, 11.81, 14.14, 17, 20.40, 24.52, 29.35 px | 8,902 `font-size` declarations over 24 distinct values. **Only 11 and 17 are on the page's scale**; the other 22 values exist nowhere on the page |
| type scale, its floor | 11px, `--text-meta`, a floor held deliberately when the ramp was rescaled | modal 10, minimum 6.5. **7,609 of 8,902 declarations, 85.5%, are below the page's floor** |
| **palette** | colour enters the application only by naming a token; the meaning-bearing set is six `--sem-*` roles plus three `--cite-*` | 0 of 290 contain `var(--`, so no figure can inherit a token or follow a theme. `theme-tokens.ts` declares seven figure hexes as "a complete declared vocabulary rather than an implicit one"; measured, the corpus paints **116 distinct fill hexes**, the declared seven carrying 10,378 of 13,044 declarations (79.6%) and **109 undeclared hexes carrying the other 20.4%** |
| **surface** | `--background`, warm paper `oklch(0.985 0.004 85)` in light, slate `oklch(0.2 0.012 264)` in dark | `--figure-surface` is `oklch(1 0 0)`, pure white, **in both themes**: in dark, an L 1.0 rectangle on an L 0.2 page |
| **ink** (holds) | `--foreground` `#1d1a14`, hue 85, warm | `FIGURE_INK` `#14181f`, hue 261.6, cool. One value corpus-wide, which is why this axis holds; `theme-tokens.ts` measures the mismatch at ΔE2000 9.23 |
| **stroke** (nothing to bind to) | no stroke scale and no spacing scale; the page declares `--measure`, `--reader-gutter`, `--figure-width` and `--figure-frame` | 25 distinct stroke widths over 3,388 declarations, modal 1 |

**The four undeclared tints are the sharpest result, because they look like a palette failure and
are not.** `#fdf0ef`, `#e6f4ee`, `#eaf1fd` and `#f0eefc` are the wrong, right, neutral and emphasis
role hues at L 0.955 to 0.965 and chroma 0.014 to 0.019, drifting 1.7° to 13.2° off their role. They
are a **second lightness step per role that nobody declared**: a panel wash carrying role meaning,
sitting just under the 0.02 atmosphere ceiling that would otherwise classify it as decoration. The
figures are out of the closed-set check's scope by construction, so nothing reads them.

**Two of these axes are the owner's sentence in the corpus's own words.** `src/lib/theme-tokens.ts`
calls the light plate on a dark page *"the white rectangle punched through a dark page"*, and
records why dimming it is worse rather than better: at plate L 0.94 two semantic fills that pass on
white already fail, which turns a 222-element remediation into 730. Of the ink it says *"a
mitigation, not a fix, and it is a taste call"*, with the mechanism stated exactly: *"a figure that
visibly sits on a different surface having a different ink reads as intentional."* **The mount makes
the foreignness legible as a choice; it does not make the figure belong.** The owner is reporting
the residual that the mitigation was chosen to live with, so quoting the mitigation back at him does
not answer him.

### The rules

[HOUSE RULE throughout, derived from the corpus's own declared values. They gate nothing. Their use
is to turn "it looks stuck on" into a disagreement about a value somebody can read.]

1. **A figure names only faces the page loads.** Not a generic that resolves to whatever the reader's
   operating system supplies, and not a page face listed behind a generic, which never wins.
2. **Every size in a figure is one of the page's declared steps, and none is below the page's floor.**
   A figure needing five sizes is usually a figure carrying two figures.
3. **Every fill and stroke either names a hex in the declared vocabulary or is added to it**, with
   its hue locked to the role it belongs to. A tint is a second lightness step of a role, not a new
   colour, and it has to be declared as one. Seven declared hexes against 116 painted is not a
   vocabulary a reader can learn.
4. **A figure's background is the page's background or a declared, reused surface.** A figure that
   ships its own panel colour reads as imported however good the drawing is. The measured instance
   here is `#f4f5f7`, 328 uses, a cool grey panel on warm paper.
5. **One figure ink, declared.** This is the axis the corpus passes, and it passes for one reason:
   a single constant is named in the token file and the figures use it.
6. **Stroke and spacing cannot be written as rules yet, and saying so is the honest entry.** The
   table's last row is the reason: there is no page value to bind a figure to, so the instruction is
   to declare the scale before checking against it. **An integration rule with nothing to integrate
   against is a preference wearing a measurement's clothes**, which is what §0's retired thresholds
   were.

### What this census is and is not

It covers all 290 figures, which is far outside §0's four rendered pages, and it is diagnostic
rather than a work order: `docs/visual-system.md` has already declined a corpus-wide SVG repair once
on scope grounds. **Rules 1 to 5 bind a figure being authored or repaired inside the current scope.**
For the rest, the census is the debt, stated at its measured value so it moves in neither direction
unobserved. Note also that the code comments quote a corpus of 152 SVGs and the corpus is now 290;
where a count matters, remeasure rather than quoting the comment.

---

## 8C. Colour, and the tension the owner has to settle

> "I am begging to include more color, and visual pleasure ... That's something lacking even now."

### First, the constraint is not the one usually reported

**There is no rule in this corpus reserving colour for links, and no rule labelled R1 or R2 about
colour anywhere in it.** (In this file R1 is the Actor rule; do not conflate them.) The link
convention that does exist is narrower than a monopoly: `--primary`, one indigo, marks a link and a
focus ring, and `src/app/globals.css` says of the citation marker that provenance belongs to its
data and source card, *"never to a second colour on a clickable anchor"*. That is a rule against
giving a link a **second** hue. It does not spend the palette.

The rule that actually constrains colour is a biconditional, stated in `src/lib/theme-tokens.ts` and
enforced from two sides:

> "Colour carries meaning if and only if it names a role from the closed declared set
> (`SEMANTIC_ROLES` plus the three `--cite-*`). Everywhere else colour is atmosphere, and atmosphere
> is capped at chroma ≤ 0.02."

[SOURCE, and the source is this codebase's own token file, not an outside author.]

### The tension, both sides, unresolved on purpose

**For more colour.** The plainness is measured rather than felt: on `/paths/decode` below the header,
**0 of 7,305,984 pixels exceed OKLCH chroma 0.04**, and the only chromatic pixels on that fold belong
to the "Create account" button, the one element on a teaching page that is not teaching. The spec has
already ruled in this direction once, in its own words: *"More colour and fix-the-defect are the same
diff."*

**Against.** The biconditional is what keeps the palette from becoming decoration, and the spec cites
Sundararajan & Adesope 2020 for direction only, magnitude deliberately not invented: *"including
seductive details in learning material can hinder learning."* Every hue admitted outside the closed
set costs the set the property that makes it readable, which is that a colour on this site means one
thing.

**Report this tension; do not resolve it.** It is the owner's call, and an author who quietly picks a
side has made a design decision inside a writing pass.

### Where the colour is, and none of it is in tension

- **Colour that encodes is already licensed.** The six roles carry declared meanings: refuted or the
  cost side of a trade; holds; the mechanism under discussion; the object of the move; a number with
  a regime attached; structural but not load-bearing. They are solved against WCAG 4.5:1 and APCA
  |Lc| ≥ 75 on both themes, and 31 application source files outside the token definitions already
  reference them. A page adopting them joins an existing language instead of inventing one.
- **The strongest form is a recurring semantic palette.** The same colour means the same thing on
  every page of a track. If the residual stream is one hue in chapter 1 it is that hue in chapter 10,
  and the reader stops decoding and starts reading. This is §6's one-canonical-example rule in a
  second channel, and it is one of §0's answers to retention.
- **Colour is never the only channel.** `SEMANTIC_ROLES` declares a glyph, a position and a stroke
  treatment per role, and the reason is measured: `--sem-wrong` against `--sem-right` is ΔE 56.1
  normal, **15.2 deuteranopic and 9.4 protanopic**, which is worse than the figure pair it inherits
  from, because solving both roles to the same Lc drives them to the same lightness. The file records
  that this is *not* fixable by choosing a better green. A distinction carried by hue alone is a
  distinction some readers do not receive, and it also dies in greyscale print.

### Measuring "no colour" is a per-screen measurement

`tools/chroma-share.mts` reports the share of pixels above chroma 0.04 **below the header, in one
viewport**, and its own docstring says what it does not measure. A long page is many screens, and a
first-screen number says nothing about the rest.

A prior session measured one long page by slicing a full-page screenshot into viewport-height bands:
23 screens, **12 of them under 0.10%, with three screens carrying nearly all the colour**. Three
coloured screens out of 23 is what "zero colours" describes from the reader's side.
[PROVISIONAL: that per-screen result is not recorded anywhere in the repository and I could not
reproduce it here; the shipped tool's one-viewport scope is verified and is the durable half.] Slice
by screen before agreeing or disagreeing with the owner about whether a page has colour.

**And a quiet screen can be correct.** The screens that stayed grey in that run were a title page and
two worked-arithmetic tables. Colouring a data table because it is grey is role-laundering, which is
the exact move the biconditional exists to refuse.

---

## 9. Math and LaTeX: choosing the register

The same idea can appear as prose, an equation, a number, a diagram, or code. **Choose the primary
register deliberately from the table below. A load-bearing object then earns a second and a third,
cross-linked rather than merely repeated (§9A).** Reading this section as *pick one and stop* is
superseded: one register is right for an ordinary claim and wrong for the object a page exists to
teach.

| register | use when |
|---|---|
| **prose** | the relation is qualitative, or has one moving part |
| **equation** | the relation has ≥ 2 interacting terms, or the reader will need to substitute into it |
| **worked number** | always, immediately after an equation, on the canonical example |
| **diagram** | the structure is spatial, or the argument is about what connects to what |
| **code** | the thing is an algorithm and the control flow is the point |

### Rules for choosing the register

- **Every equation is followed by its substitution.** An equation the reader has not seen evaluated
  is an equation they will not use.
- **Define every symbol at first use**, in three words, inline.
- **Do not use an equation as decoration.** If it is not substituted into or reasoned about, it is a
  picture of rigour rather than rigour.
- Display math for anything with a fraction or a sum; inline for single symbols and simple ratios.

---

## 9A. One object, more than one angle

The owner, in the same message:

> "Looking forward to learning, building intuition, understand various angles of the same topic and
> evaluating myself how well I know something"

**This is a separate ask from §7B and the two are easy to merge by accident.** §7B is about kinds of
*seeing*: geometric, dimensional, limiting, physical, counterfactual, historical, analogical. This is
about **one object appearing in more than one register on the page, with the registers pointing at
each other.** A page can carry three kinds of intuition about three different things and still never
show the reader that its equation and its picture are the same object.

### The five angles on one object

| angle | what it delivers that the others cannot |
|---|---|
| **the equation** | the exact relation, with every symbol defined and substitutable |
| **the drawn geometry** | what the operation does to a direction, a subspace or a rank |
| **the worked number** | the size of the effect on the canonical example, with units |
| **the failure mode** | what the object looks like when it goes wrong, which is how the reader will meet it in production |
| **the systems consequence** | what changes downstream: bytes, latency, a serving decision |

### The rule

**[HOUSE RULE.] The angles are cross-referenced by name. A reader must never have to work out on
their own that the picture and the equation are the same thing.** Three obligations follow:

- **One name, everywhere.** §6B's one-canonical-name-per-concept rule is what makes cross-referencing
  possible at all. The measured failure is on record: one quantity under four names (`m`, `d_ff`,
  `intermediate_size`, "hidden features"), where the figures used one set and the prose the other, so
  the page's cleanest result was stated in symbols the surrounding text never used.
- **Each angle names one other, in its own text.** *"In the gated row of Figure 1"* is what §8 says a
  caption number is for. The equation says which figure draws it; the figure's caption says which
  equation it draws; the worked number says which line of the equation it substitutes into.
- **Not every object gets this.** Reserve it for the object the page exists to teach: the one named
  in the title, and the one §0's spoken-defence standard says the reader will have to defend.

### This does not license restating

R5 says the fact once and deletes the sentence that explains the sentence just read. It also states
its own boundary: *"A second representation earns space by adding a calculation, boundary, or
experiment."* **A second angle is a second representation, not a second statement.** An angle that
can be removed without losing a calculation, a boundary or an observable result is a restatement,
and R5 deletes it.

### The cost, which is real and belongs in the decision

§8 requires that when a claim changes it changes on all of prose, caption, figure text, `aria-label`,
summary line and derived instrument. **Every angle added is one more surface that must move in the
same commit**, and §12 states the consequence of getting that wrong: fixing 4 of 7 sites is worse
than fixing 0, because a document precise in one place and loose in another teaches the reader to
distrust the precise one. Adding an angle is a maintenance commitment, which is the reason to reserve
it for load-bearing objects rather than to apply it everywhere.

---

## 10. Sentences

- **Vary length.** A run of same-length sentences reads mechanical even when each is fine.
- **Short sentences carry the important claims.** A 9-word sentence after three 30-word ones lands
  hard. That is the main rhythmic tool available.
- **Avoid appositive pile-ups.** Three or more comma-delimited clauses qualifying one noun means the
  sentence is a list wearing a disguise. Make it a list, or split it.
- **Watch antithesis as rhythm.** R3 caps `rather than` at one per page. Other contrasts must
  distinguish something the reader needs to distinguish. Do not remove true negation to hit a count.
- **Choose causal connectors deliberately.** R2 allows one *so* per sentence. R10 also asks
  whether adjacent sentences repeat it.
- **Close with the result.** Use a computed number or a full active sentence, without an
  aphoristic fragment or a second explanation of the same point.
- **Do not start consecutive paragraphs with the same construction.** Especially "That is", "What",
  "It is", "The point is".

---

## 11. Diagnosing prose that "reads like AI wrote it"

Treat the complaint as editing feedback. No human-versus-machine comparison establishes these
as authorship detectors. Use the owner's named tells:

| Tell | Repair |
|---|---|
| **Abstract noun as agent** | Name the relevant actor and action (R1). |
| **Contrast as rhythm** | Deliver the positive fact; compare only when comparison adds content (R3). |
| **Fragment closers** | End with a number or a full active sentence (R4). |
| **Saying it twice** | Delete the paraphrased conclusion (R5). |
| **Pointing instead of delivering** | Give the calculation or a content-named link (R6). |
| **And where so belongs** | Express a real causal relation, with one *so* per sentence (R2). |
| **Hedges/filler/passive** | Name the actor, condition, and action (R9). |
| **Word echo** | Read the final two sentences together (R10). |
| **Statement where experiment belongs** | Tell the reader what to change and inspect (R8). |
| **Over-scrubbing standard terms** | Define the standard term beside its number or operation (R7). |
| **Em dash** | Use ASCII ` -- `, with quotation handling made explicit (R11). |
| **Numbers as ornament** | Calculate the quantity and name what it measures (R12). |

Use counts to find candidates, then read them. A repeated word can be mathematically necessary;
a sentence with no flagged words can still say nothing.

---

## 12. Rewriting an existing document safely

Learned the hard way, and it is not optional.

- **Bounded regions only.** Replace a span you have read, with an anchor you have verified is
  unique. Never regenerate a whole file.
- **Keep teaching and grading consistent.** Search the claim's distinctive terms across
  front matter, prose, `requires`, foil explanations, captions, figure text, and `aria-label`.
  A correct explanation beside a false scored anchor is incomplete. If the anchor is outside
  the authorized scope, report that dependency and its grading consequence.
- **Compute numbers; preserve attribution.** The old *may not change a digit* instruction is
  superseded. Record the original, the calculation, the corrected result, and affected claims.
  Do not change a quoted source to make it correct. Add a correction outside the quotation,
  or replace it with a sourced paraphrase.
- **Test the inference too.** A correctly multiplied scalar product does not establish that
  each factor must be near one. A calculation for random vectors does not describe learned
  vectors without evidence. An assumed peak rate gives a theoretical bound, not a measured
  operating regime. The baseline-specific counterexamples are in `owner-examples.md`.
- **Check the replacement, not its audit.** For each claimed repair, reread the actual sentence
  and its assumptions. An audit saying *attention is nonlinear* does not repair a replacement
  that still claims attention cannot compute a pointwise nonlinear function. Do not add a new
  theorem to fill the space left by a deleted restatement.
- **Normalize punctuation openly.** When a published quotation's punctuation changes to meet
  R11, label it *punctuation normalized*. Retain the original in the source or backup.
- **Validate within the assignment.** Use the applicable existing quote/content tests when
  application changes are authorized. A skill-only assignment does not authorize application
  gates, builds, server processes, commits, or a broader rewrite.
- **Your repairs are the next round's defects.** Review replacement text harder than the original.
  It was written faster, by someone who had just convinced themself they understood the problem.
- **Fixing 4 of 7 sites is worse than fixing 0**, because a document that is precise in one place
  and loose in another teaches the reader to distrust the precise one.
- **Measuring a reference is not reading it.** Three design references the owner supplied were
  characterised by extracting a PDF's text and scripting two blogs for widths and element counts,
  with no image ever looked at. Three errors followed. The worst was a number: **"156 vector
  drawings, 5 to 9 per page"** for a handbook whose pages carry **one** small schematic each,
  because `get_drawings()` counts path primitives and a three-box diagram with two arrows is nine
  of them. The owner's own words about that document were *"Visuals are not rich in it"*, and the
  number told the next agent the opposite, from the same document. **Render a reference and look at
  it before writing anything about it, and check what unit a count is in before quoting it.**
- **A correction needs the same evidence standard as the claim it corrects.** This file has taken a
  false measurement from a correction, not from the original. The correction reported a source
  absent from the cache and a term occurring once instead of 15 times, and it arrived with a causal
  story: that the original count had matched `situation`. The story was plausible, self-consistent,
  and wrong. **A wrong probe that explains itself is more dangerous than one that just returns a
  number**, because the explanation is what earns it belief. Before overturning a measurement,
  reproduce the original's result, not only your own.
- **Silence from a search is incapacity until proven otherwise, and one form of it is fully
  silent.** Ledger extracts from PDFs keep typographic ligatures and NUL bytes, so `file` reports
  *data* and the tooling treats them as binary. Measured on this box against a term known to occur
  15 times: `grep` without `-a` prints nothing and exits **1**; `rg` given the file path returns the
  matches; and **`rg` walking the containing directory drops the file with exit 0 and no warning on
  either stream.** The first at least fails loudly. The third returns a shorter, plausible, complete
  looking result. `grep -a` and `rg --text` read them correctly. **Put a term you know is present
  through the identical probe before you believe a zero** -- a control term is the only thing that
  distinguishes "not there" from "not read", and it must run through the same command, over the same
  paths, as the probe it is controlling.

### The cold read: the instrument for "this doesn't teach me"

No count in this file detects a page that states its mechanism and never states its purpose. Style
checkers cannot see it. This is what found it:

> **Five readers of declared, different backgrounds, each reading the *delivered* text -- prose plus
> figure text plus captions plus margin notes with every disclosure opened -- and each asked to
> state in ONE sentence what the page taught them, with "I could not say" a permitted answer.**

Reading the delivered surfaces is the first detail that makes it work. The source files are not what
the reader gets, and three of this campaign's sharpest findings lived in figure drawn text. The
permitted refusal is the second: without *I could not say* on the table, the instrument measures
fluency at inventing a summary.

**Its weakness, stated honestly.** Five synthetic readers agreed 5/5 on four separate findings, and
agreement among agents given one prompt is partly a property of the prompt. The findings that
survived independent verification at the file are the ones worth acting on. Treat unanimity as a
place to look, not as a result.

---

## 13. Reading list

These are readings selected by the owner, with house-rule tags indicating what to study.
The tags do not mean the authors endorse our wording rules. Learn the explanation technique;
do not copy their prose or import their numerical assumptions into a different workload.

| Reading | Tags | Reading focus |
|---|---|---|
| Horace He, [Making Deep Learning Go Brrrr From First Principles](https://horace.io/brrr_intro.html) | **R1 / R7 / R12** | GPU work, named performance terms, and calculations. |
| kipply, [Transformer Inference Arithmetic](https://kipp.ly/transformer-inference-arithmetic/) | **R12** | Substitute dimensions, count bytes and FLOP, and keep the model assumptions visible. |
| Google DeepMind, [How to Scale Your Model](https://jax-ml.github.io/scaling-book/) | **R6** | Organize links around the calculation or capability the reader needs. |
| Hugging Face, [The Ultra-Scale Playbook](https://huggingface.co/spaces/nanotron/ultrascale-playbook) | **R2 / R5** | Follow causes and consequences without repeating their conclusion. |
| Karpathy, [Yes you should understand backprop](https://karpathy.medium.com/yes-you-should-understand-backprop-e2f06eab496b) | **R8 / R9** | Use imperative experiments and failure stories with a concrete actor. |
| Michael Nielsen, [Neural Networks and Deep Learning, chapter 1](http://neuralnetworksanddeeplearning.com/chap1.html) and [chapter 2](http://neuralnetworksanddeeplearning.com/chap2.html) | **R8** | Turn an explanation into an operation the learner can perform. |
| Elhage et al., [A Mathematical Framework for Transformer Circuits](https://transformer-circuits.pub/2021/framework/index.html) | **R7** | Introduce technical vocabulary beside the object or computation it names. |

**Verification limits for this revision:** the links above returned their expected pages;
kipply redirected to `https://kipp.ly/p/transformer-inference-arithmetic`. Only the Hugging Face
Space shell was read, not the embedded playbook. The remaining page openings were read, not their
entire texts. These are a reading list, not a completed source audit.

Karpathy's Medium page returned HTTP 403 here. Its title and canonical URL were confirmed by
the [Southampton backpropagation handout](https://comp6248.ecs.soton.ac.uk/handouts/backprop-handouts.pdf);
that verifies the link, not completion of the reading. The `2016/05/25/rl/` path is a different
article.

---

# The philosophy

The reading stance below explains useful older guidance. It does not override R1–R12.

## Prose is a window

Thomas & Turner's **classic style**, which is the model Pinker builds on: the writer has seen
something in the world, and writes to let the reader see it too. Prose is a window onto the subject.
The reader is a competent equal who simply happens not to have been standing where the writer was
standing.

That single stance generates almost every rule. Metadiscourse dies because you do not narrate the
shape of the window while pointing through it. Hedges die because you do not apologise for the view.
Nominalizations die because things in the world are done by somebody. Signposts survive, sparingly,
because you do point.

Thomas & Turner's cookbook analogy (punctuation normalized: the two prose dashes use ASCII
` -- `; the wording and existing ellipsis are retained):

> "When we open a cookbook, we completely put aside -- and expect the author to put aside -- the kind
> of question that leads to the heart of certain philosophic and religious traditions. Is it
> possible to talk about cooking? Do eggs really exist? ... Classic style similarly puts aside as
> inappropriate philosophical questions about its enterprise. If it took those questions up, it
> could never get around to treating its subject, and its purpose is exclusively to treat its
> subject."

## It is a pose, and knowing that is what keeps it honest

Pinker is explicit that classic style is a stance rather than a claim about knowledge:

> "For all its directness, classic style remains a pretense, an imposture, a stance. Even
> scientists, with their commitment to seeing the world as it is, are a bit postmodern. They
> recognize that it's hard to know the truth... **It's just that good writers don't flaunt that
> anxiety in every passage they write; they artfully conceal it for clarity's sake.**"

This matters for technical writing specifically. Concealing the anxiety is not the same as
concealing the *uncertainty*. Uncertainty about the world is content and belongs on the page as a
stated bound, a named domain, a measured error. Anxiety about being criticised is not content, and
that is what hedges, shudder quotes and pre-emptive apologies actually encode.

**Say the bound. Do not say "somewhat".**

## The curse of knowledge is the root cause

Most bad technical writing is not laziness or vanity. It is the writer's inability to imagine not
already knowing the thing. Every symptom follows: unexplained jargon, abstraction where an example
belonged, a step skipped because it felt obvious, a term used before it was defined.

You cannot fix this by trying harder to be clear, because the defect is invisible from the inside.
You fix it structurally: show it to someone else, re-read it cold, and instantiate every abstraction
against a concrete example you declared up front.

## Why the reader is owed why-not and what-else

A claim on its own can only be memorised. What makes it usable is knowing what would have to change
for it to stop being true.

That is also the honest position. Every real technical claim has a domain. Stating it is not
hedging, it is the content. A claim delivered without its domain will be over-applied, and
over-application does more damage than ignorance, because the reader now has confidence.

## What "good" feels like when it lands

The reader finishes a section and can state the claim, name what forces it, name the option that
lost and why, and say where it stops holding. They can picture a concrete instance with real
numbers. They never had to parse a sentence twice. They never read a paragraph about the document
instead of the subject.

The reader can apply the calculation and test its boundary.
