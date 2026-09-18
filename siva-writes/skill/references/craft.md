# Craft reference

The long-form craft sections of siva-writes, moved out of SKILL.md so the skill itself stays
loadable. SKILL.md carries the rules that bind every document; this file carries the reasoning,
the sources, and the worked repairs behind them.

Read the section SKILL.md points you at. Reading all of it is not the intended use.

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

---

# The philosophy

The reading stance below explains useful older guidance. It does not override R1–R12.

---

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

---

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

---

## The curse of knowledge is the root cause

Most bad technical writing is not laziness or vanity. It is the writer's inability to imagine not
already knowing the thing. Every symptom follows: unexplained jargon, abstraction where an example
belonged, a step skipped because it felt obvious, a term used before it was defined.

You cannot fix this by trying harder to be clear, because the defect is invisible from the inside.
You fix it structurally: show it to someone else, re-read it cold, and instantiate every abstraction
against a concrete example you declared up front.

---

## Why the reader is owed why-not and what-else

A claim on its own can only be memorised. What makes it usable is knowing what would have to change
for it to stop being true.

That is also the honest position. Every real technical claim has a domain. Stating it is not
hedging, it is the content. A claim delivered without its domain will be over-applied, and
over-application does more damage than ignorance, because the reader now has confidence.

---

## What "good" feels like when it lands

The reader finishes a section and can state the claim, name what forces it, name the option that
lost and why, and say where it stops holding. They can picture a concrete instance with real
numbers. They never had to parse a sentence twice. They never read a paragraph about the document
instead of the subject.

The reader can apply the calculation and test its boundary.
