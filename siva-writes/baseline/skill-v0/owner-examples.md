# Owner worked examples

Read these with R1–R12 in [SKILL.md](SKILL.md). The submitted rewrites are preserved as
style models, with spacing and mathematical typography normalized. Their claims have not been
silently corrected inside the submitted blocks. Use the corrected versions when applying the
guidance. The owner controls the style; arithmetic and technical scope still need checking.

## Titular fragments: RV-C71YE-VPPVE

The owner's three quoted strings expose one editorial failure on two different surfaces.
The first two are SVG text. The third is a Markdown heading inside the MLP disclosure,
not SVG text; classify the actual rendered source before deciding what was covered.

| Owner-quoted text | Direct replacement | Test |
|---|---|---|
| "Not a diagonal. Two of the H directions are deleted, and they are deleted because the forward pass ignored them." | "At zero numerical epsilon, LayerNorm removes the shift and scale directions." | Name the operation and condition. A computation does not choose to ignore a direction. |
| "The same operation, two positions, one factor of root L" | "Normalisation placement changes the gradient bound" | Replace the comma triple with a concrete subject and finite verb. |
| "The mathematics, done rather than named" | "Derivations" | Use the topic; do not advertise how the document presents it. |

The first replacement assumes a nonconstant input and describes the derivative before the
learned affine transform. Positive numerical epsilon removes exact scale invariance; the
uniform-shift direction remains null. Keep those conditions in the figure and its accessible
description rather than making a shorter title overstate the result.

**Keep the comparison:** "Normalise the branch output rather than its input" is an imperative
with a meaningful alternative, not a titular fragment. **Keep the disclosure:** "Schematic,
not to scale; the numbers are printed rather than plotted" tells the reader how to interpret
the drawing. Neither is repaired by deleting *rather than*. Component labels such as
"Attention scores" are also useful nouns. The defect is decorative headline prose, not the
absence of a verb in every navigation label.

The baseline failure was observed in the deployed pilot under the existing skill. The
figures had not received the earlier prose pass, and the source disclosure retained a
rejected heading. A style review must read the rendered dependency set, not a guessed glob.

## 1. Position and causal masking

**Before, supplied by the owner:**

> Attention has no term in which position could appear. This is the strongest forcing argument
> in the corpus, and it is worth reading for its shape as much as its content: it proves the
> property, then refutes its own opening...

**Owner-submitted rewrite; read the technical correction below:**

> Attention never sees position. Permute the input rows and QK^T permutes with them; softmax
> and the weighted sum of V permute the same way. So the output is the same permutation of the
> original output. That is equivariance -- outputs move with inputs -- not invariance.
> The causal mask does leak position: position t sees t+1 rows, position 0 sees one, and a decoder
> learns to read that count as a weak clock. Weak is not enough, so we add position on purpose.

**Technical correction.** The first sentence is scoped to **unmasked, position-free
self-attention**. Let `P` permute the input rows. Pointwise projections give `Q' = PQ`,
`K' = PK`, and `V' = PV`; the score matrix changes on **both axes**:
`S' = P S P^T`. Row-wise softmax satisfies
`softmax(P S P^T) = P softmax(S) P^T`, so the output is `P softmax(S) V`.
This is equivariance, not invariance.

A fixed causal mask does not generally commute with `P`, so that general equivariance fails.
With zero-based indexing and self-attention to the current position, row `t` admits `t+1`
positions. The changing count alone does not prove that any decoder can recover position:
identical value vectors, for example, can give identical normalized averages despite different
counts. Claims about a learned positional signal need their model assumptions and evidence.
Do not turn the owner's word *never* into a required sentence opening.

**Corrected application:**

> Permute the input rows of unmasked self-attention with no positional features. Both axes of
> QK^T permute: the score matrix becomes P(QK^T)P^T. Row-wise softmax and the multiplication
> by the permuted V preserve the correspondence, so the output rows follow the input permutation.
> This is equivariance -- outputs move with inputs. Invariance would leave the output unchanged.
>
> Apply a fixed causal mask. It breaks general permutation equivariance: at zero-based position
> t, the query can attend to t+1 positions. That changing access can provide positional information,
> but the count alone does not establish what a model learns. Add positional features to represent
> order and distance explicitly.

## 2. KV storage and arithmetic intensity

**Before, supplied by the owner:**

> ...the arithmetic intensity of that read decides the regime the whole machine runs in.
> This is the stop where the ground-up walk meets the physics track.

**Owner-submitted rewrite; read the technical correction below:**

> Each decode step needs K and V for every prior token. We cache them instead of recomputing:
> 2 x 93 layers x 7168 x 2 bytes ~= 2.67 MB per token in BF16, before GQA divides by
> heads/kv_heads. At batch 1 the attention read does about 1 FLOP per byte fetched, an
> arithmetic intensity of 1. An H100 crosses from memory-bound to compute-bound at
> 989 TFLOPS / 3.35 TB/s ~= 295 FLOP/byte. We are 300x below the line: decode is
> bandwidth-bound. The roofline chapter picks up from this 295.

**Calculations and scope:**

- For ordinary MHA with `L = 93`, `Hq * dh = Hkv * dh = 7168`, and BF16 at two bytes
  per scalar, one token's K and V occupy
  `2 * 93 * 7168 * 2 = 2,666,496 bytes = 2.666496 MB = 2.54296875 MiB`.
  MB is decimal; MiB uses `2^20` bytes.
- GQA divides that head-wise cache by `g = Hq / Hkv` only with layer count, query width,
  head dimension, and element size held fixed. This is not MLA's latent cache formula.
  A width of 7,168 does not identify the model used by a linked lesson.
- For context length `S`, the leading QK and AV products perform
  `4 * L * S * Hq * dh` FLOP. Reading K and V once costs
  `2 * L * S * Hkv * dh * b` bytes. Their ratio is `2g/b`, giving `g` FLOP/byte
  at BF16 `b = 2`, and 1 for plain MHA. This assumes ideal reuse of each KV head across
  its query group and omits softmax, other traffic, and extra work. Batch 1 does not make
  the intensity 1 for GQA.
- Using the owner's declared peaks,
  `(989 * 10^12 FLOP/s) / (3.35 * 10^12 byte/s) = 295.223880597... FLOP/byte`.
  At intensity 1 the ratio is about 295, or about 300 to one significant figure.
  This is a theoretical roofline comparison, not a measured speedup.
- The **H100 SXM dense-BF16 peak attribution still needs a verified vendor source** before
  publication. Confirm dense versus sparse throughput, device variant, and bandwidth units.
  The arithmetic above checks the supplied constants; it does not verify the specification.
- Bound the conclusion to this attention work and its assumptions. It does not establish
  that all decode work at all batches is bandwidth-bound.

**Corrected application using conditional hardware constants:**

> Cache the keys and values so later decode queries can reuse them. For ordinary MHA with
> 93 layers, total head width 7,168, and two-byte BF16 values, one token occupies
> 2 x 93 x 7,168 x 2 = 2,666,496 bytes, or 2.666496 MB.
>
> Let g be query heads per KV head. With ideal KV reuse, the leading BF16 attention
> products perform g FLOP per byte fetched; this ratio is their arithmetic intensity.
> Plain MHA has g = 1. For hardware specified at 989 TFLOP/s and 3.35 TB/s, the
> theoretical ridge is 989 / 3.35 = 295.22 FLOP/byte. This MHA attention work is
> below the ridge, so its roofline bound is set by memory bandwidth under these assumptions.

If a link follows, name its content, for example **KV traffic and the bandwidth roofline**.
Resolve the destination before adding its URL. Do not replace the old label with a made-up link.

## 3. Feedforward width and parameter matching

**Before, supplied by the owner:**

> The four-times expansion was never argued for in the paper that introduced it. The gated
> correction to eight-thirds has a reason, and the step gives it.

**Owner-submitted rewrite; read the technical correction below:**

> Vaswani et al. set d_ff = 4d with no rationale. The 8/3 comes from parameter matching:
> a gated MLP (SwiGLU) uses three matrices instead of two. The plain MLP costs
> 2 x d x 4d = 8d² parameters. To spend the same budget across three matrices, each gets
> 8d²/3, which gives d_ff = 8d/3. So SwiGLU keeps the 8d² parameters and adds one
> matmul per position.

**Technical correction.** Assume bias-free projections with the same input and output width `d`.
Two plain-MLP matrices at inner width `4d` have `2d(4d) = 8d²` parameters. Three gated
matrices at inner width `m` have `3dm`. Solve `3dm = 8d²` for `m = 8d/3`;
each matrix then contains `dm = 8d²/3` parameters.

There are three projection matmuls instead of two, but they are narrower. At the exact matched
width their leading projection FLOP budgets agree; do not imply an extra matmul of the old size.
Gating also adds an elementwise product and changes the activation. Biases and rounding `m`
to a hardware-friendly multiple affect exact equality.

Scope *no rationale* to the paper's stated dimensions, after reading that passage. It is not a
claim about everything the authors or later literature have said. The derivation below does not
need a historical absence claim.

**Corrected application:**

> Count the parameters in a bias-free MLP with input and output width d and inner width 4d.
> Its two matrices contain 2 x d x 4d = 8d² parameters.
>
> SwiGLU uses an up projection, a gate projection, and a down projection. With inner width m,
> their matrices contain 3dm parameters. Match the plain MLP's budget:
> 3dm = 8d² gives m = 8d/3. The gated MLP uses three narrower projection matmuls
> instead of two; hardware rounding of m can change the parameter count.

For an integer check, choose `d = 3`: the plain width is 12 and the gated width is 8.
Both budgets are `2 * 3 * 12 = 3 * 3 * 8 = 72` parameters.

## Baseline claims that arithmetic alone does not repair

Apply R12 to what the numbers purport to establish. The actual rejected path contains these
additional traps; a rewrite must not carry them over merely because they sound technical.

- **Attention is nonlinear in its input.** With linear projections, multiplying the input by
  2 multiplies Q and K by 2 and QK^T by 4. The score is already quadratic in the input;
  softmax adds another nonlinearity. A weighted sum of V is linear **when its attention weights
  are held fixed**. That conditional fact cannot establish that removing the MLP makes an
  attention network linear or incapable of conjunctions. Explain the MLP's distinct position-wise
  transformation without inventing a necessity proof.
- **A product bound is not a bound on each factor.** For 93 positive scalar gains, constraining
  each gain to `[2^(-1/93), 2^(1/93)]` is sufficient to constrain their product to `[1/2, 2]`.
  The endpoints are `0.9925745107...` and `1.0074810397...`. The condition is not necessary:
  gains `2, 1/2`, followed by 91 gains of 1, have product 1. General Jacobian matrices require
  further assumptions; this scalar example does not prove a necessary per-layer band or
  that initialization cannot work.
- **Random directions are a model, not a description of trained features.** At `d = 7168`,
  independent isotropic unit vectors have expected squared dot product `1/d` and RMS dot
  product `1/sqrt(d)`. Nothing in that expectation establishes that a model's learned writes
  are independent, isotropic, or nearly orthogonal. Name the assumption before using the result.
- **Breaking a symmetry does not specify a learned representation.** A fixed causal mask breaks
  general permutation equivariance. That fact alone proves neither that a decoder can recover
  distance from it nor that distance is impossible to recover.

### Current pilot grading disposition

The parent found coupled defects in two out-of-scope rubric questions:
`delete-the-mlp` asserts that attention cannot transform its own input nonlinearly;
`the-band` promotes an equal scalar-gain bound to independent Jacobian requirements.
The current pilot excludes both. It uses **`linear-collapse` / `the-two-thirds`** for
feedforward layers and **`floor-not-ceiling` / `half-not-one`** for the residual stream.

Excluding those questions protects this pilot from grading the corrected explanation against
those false claims; it does not repair the original rubrics or certify their replacements.
Keep the exclusions when applying this skill to the pilot. Report the unresolved source defects
without expanding the authorized edit beyond the two pages and this skill.

## Applying the examples

Check the proposed prose itself, including adjacent fields and the final sentence.
An accompanying audit can claim a correction that the prose still contradicts. Bounded
fresh-context trials exposed that failure; these instructions do not guarantee model
compliance or replace the owner's review.
