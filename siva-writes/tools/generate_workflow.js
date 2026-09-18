export const meta = {
  name: 'siva-writes-generate',
  description: 'Generate condition A/B/C/D outputs over the 40 frozen briefs',
  whenToUse: 'Phase 4 execution, after the eval is frozen and the skill is installed',
  phases: [
    { title: 'Generate', detail: '40 briefs x 4 conditions, each agent reading its brief and writing one file' },
  ],
}

const ROOT = '/home/spopuri/my_stuff/agent-tools/siva-writes'

// args is a compact [[id, genre, target_words], ...] list. Brief text, condition system prompts
// and the exemplar index all live on disk for the agent to read; inlining them made args 95 KB.
const EXEMPLARS = {
  design_doc: ['aws-timeouts-retries-backoff-jitter.txt', 'aws-workload-isolation-shuffle-sharding.txt'],
  rfc: ['pep-0572-assignment-expressions.txt', 'rust-rfc-2229-capture-disjoint-fields.txt'],
  postmortem: ['gcp-incident-ow5i3PPK96RduMcb1SsW.txt', 'danluu-postmortem-lessons.txt'],
  perf_analysis: ['danluu-latency-pitfalls.txt', 'danluu-perf-opt.txt'],
  status_update: [],
}
const CONDITIONS = {
  A: { label: 'no skill', system: false, exemplars: false, stages: false },
  B: { label: 'rules only', system: true, exemplars: false, stages: false },
  C: { label: 'rules + exemplars', system: true, exemplars: true, stages: false },
  D: { label: 'full skill', system: true, exemplars: true, stages: true },
}

const briefs = args.map(([id, genre, target_words]) => ({
  id, genre, target_words, exemplars: EXEMPLARS[genre] || [],
}))
const conditions = CONDITIONS

phase('Generate')

const jobs = []
for (const cond of Object.keys(conditions)) {
  for (const b of briefs) jobs.push({ cond, brief: b })
}

log(`${jobs.length} generations: ${Object.keys(conditions).join(', ')} over ${briefs.length} briefs`)

const results = await parallel(jobs.map((job) => () => {
  const c = conditions[job.cond]
  const b = job.brief

  const systemBlock = c.system
    ? `FIRST, read ${ROOT}/eval/conditions/${job.cond}.md and follow it. It is the writing guidance
you are working under.\n\n`
    : ''

  const exemplarBlock = c.exemplars && b.exemplars.length
    ? `\n\nALSO read these two documents in full before writing:
${b.exemplars.map((f) => `  ${ROOT}/skill/references/exemplars/${f}`).join('\n')}

They are ${b.genre.replace('_', ' ')} documents by expert engineers, and they outrank any rule you
have been given: a rule is a compression of what these do, and the compression loses. Match how they
carry a claim - where the claim sits in a paragraph, how a number arrives, when they hedge and when
they do not. Do not match their subject matter.`
    : ''

  const stageBlock = c.stages
    ? `\n\nWork in three stages and do not skip to stage 2.

STAGE 1. Write a brief for yourself, under 150 words: Claim (the one sentence the reader should be
able to say afterwards), Evidence (the quantities with units and where each came from), Mechanism
(why it is true, not that it is true), Decision (what changes because of this).

STAGE 2. Write the document from YOUR STAGE 1 BRIEF, not from the raw material. Anything that did
not make your brief does not belong in the document.

STAGE 3. Check the draft and revise: does sentence one state your claim; does every claim resting on
a quantity carry that quantity with its unit; does each paragraph open with its own claim; does any
paragraph carry two claims; are there patterns from the negative set. You may run
\`python3 ${ROOT}/skill/scripts/prose-check.py <your file>\` after writing it, and revise.`
    : ''

  return agent(
    `${systemBlock}Read ${ROOT}/eval/jobs/${b.id}.md. It contains raw material and an ask.

Write the ${b.genre.replace('_', ' ')} it asks for, about ${b.target_words} words.${exemplarBlock}${stageBlock}

Save the finished document with the Write tool to exactly:
  ${ROOT}/eval/outputs/${job.cond}/${b.id}.txt

The file must contain ONLY the document: no stage-1 brief, no self-review notes, no preamble, no
markdown fence around the whole thing. Write it in one call; it is short.

Your final message is the single word DONE. Do not repeat the document back - the file is the
artifact, and echoing it wastes the turn.`,
    { label: `${job.cond}:${b.id}`, phase: 'Generate', effort: 'medium' },
  ).then(() => ({ cond: job.cond, id: b.id, ok: true }))
   .catch((e) => ({ cond: job.cond, id: b.id, ok: false, error: String(e).slice(0, 120) }))
}))

const ok = results.filter((r) => r && r.ok).length
const failed = results.filter((r) => r && !r.ok)
log(`${ok}/${jobs.length} generated, ${failed.length} failed`)

return {
  generated: ok,
  total: jobs.length,
  failed: failed.map((f) => `${f.cond}:${f.id} ${f.error || ''}`),
  by_condition: Object.fromEntries(Object.keys(conditions).map((c) =>
    [c, results.filter((r) => r && r.ok && r.cond === c).length])),
}
