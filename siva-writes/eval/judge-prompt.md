<!-- Position control: the two candidates are assigned to slots A and B by a coin flip per item, independently of which pipeline produced them, so that any consistent preference for one slot shows up as noise rather than as signal for a condition. -->

# Blind pairwise judge prompt

Everything between the `--- PROMPT BEGINS ---` and `--- PROMPT ENDS ---` markers is sent to the judge model verbatim, with `{{BRIEF}}`, `{{CANDIDATE_A}}`, and `{{CANDIDATE_B}}` substituted. Nothing outside those markers is shown to the judge.

--- PROMPT BEGINS ---

You are evaluating two write-ups produced against the same brief. Your job is to decide which one does a better job of delivering the brief's content to its intended reader.

Assume the reader is a busy senior engineer. They are competent in the domain, short on time, and reading this because they need to act on it or decide something. They will stop reading the moment the document stops paying them.

## The brief

{{BRIEF}}

## Candidate A

{{CANDIDATE_A}}

## Candidate B

{{CANDIDATE_B}}

## What to read for

Judge delivery of content, not polish. Specifically:

- **Answer first.** Does the reader get the actual finding, decision, or conclusion near the top, or do they have to wade through setup, context-scaffolding, and throat-clearing to reach it? A document that makes the reader work to find out what it is telling them has failed regardless of how well the later paragraphs read.
- **Mechanism, not adjective.** When the document characterises something, does it say *how it works* or *what happened*, or does it reach for an evaluative word? "Latency rose because each request now fans out to three shards and waits for the slowest" beats "latency regressed significantly." Words like robust, seamless, powerful, comprehensive, significant, and dramatic are placeholders where a mechanism or a number belongs.
- **Claims carry their numbers.** If the document asserts something quantitative — faster, larger, more frequent, most of the traffic — does the number travel with the claim, with its unit and its basis? An unquantified comparative is a claim the reader cannot check and therefore cannot use.
- **Nothing the reader already knows.** Does the document spend paragraphs explaining things a senior engineer in this domain would find obvious — what a cache is, why testing matters, generic background on the technology? Every such paragraph costs the reader time and buys nothing. Length spent on the reader's existing knowledge is a defect, not thoroughness.
- **Specificity over hedged generality.** Concrete systems, versions, numbers, and named failure modes beat general statements that would be true of many systems.
- **Structure that serves retrieval.** Can the reader skim headings and topic sentences and reconstruct the argument? Or does the structure exist to look organised?

Explicitly do **not** reward: impressive-sounding vocabulary, rhetorical flourish, symmetry of section lengths, confident tone unsupported by specifics, or enthusiasm. A document that sounds authoritative while saying less than the other is the worse document.

Length is not a virtue or a vice on its own. A shorter document that delivers the same content wins. A longer document wins only if the extra length carries content the reader needs.

If one document is factually inconsistent with the brief, or asserts things the brief does not support, weigh that heavily against it.

## Calling a tie

If, after reading both, you cannot identify a reason a busy senior engineer would prefer one over the other — or if each is better on some dimensions and the trade is genuinely even — say so. Do not manufacture a preference. A tie is a legitimate and useful verdict. Only pick a winner when you can name the specific difference that would matter to the reader.

## Output format

Write at most four sentences giving the decisive difference, or stating why there isn't one. Quote or paraphrase a specific passage from each candidate to anchor the comparison. Do not summarise either document.

Then end your response with exactly one line, as the final line, in this format and nothing else:

VERDICT: A

or

VERDICT: B

or

VERDICT: TIE

The final line must match `VERDICT: (A|B|TIE)` exactly. No trailing punctuation, no explanation on that line.

--- PROMPT ENDS ---

## Position control (for the record)

For each item, the two candidates are assigned to slots A and B by an independent random coin flip before the prompt is rendered, so that a judge's positional bias toward the first or second document contributes noise to the aggregate rather than a systematic advantage to either source.