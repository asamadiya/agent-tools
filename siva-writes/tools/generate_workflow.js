export const meta = {
  name: 'siva-writes-generate',
  description: 'Generate condition A/B/C/D outputs over the 40 frozen briefs',
  whenToUse: 'Phase 4 execution, after the eval is frozen and the skill is installed',
  phases: [
    { title: 'Generate', detail: '40 briefs x 4 conditions, each agent writing one file' },
  ],
}

const ROOT = '/home/spopuri/my_stuff/agent-tools/siva-writes'

// args: {briefs: [...], conditions: {A: {...}, ...}} supplied by the caller so the workflow does
// not have to read and inline 40 briefs into its own script text.
const briefs = args.briefs
const conditions = args.conditions

phase('Generate')

const jobs = []
for (const cond of Object.keys(conditions)) {
  for (const b of briefs) {
    jobs.push({ cond, brief: b })
  }
}

log(`${jobs.length} generations: ${Object.keys(conditions).join(', ')} over ${briefs.length} briefs`)

const results = await parallel(jobs.map((job) => () => {
  const c = conditions[job.cond]
  const b = job.brief

  const exemplarBlock = c.exemplars && b.exemplars.length
    ? `\n\n=== EXEMPLARS ===\nTwo documents of this type, written by expert engineers. They outrank
any rule you have been given: a rule is a compression of what these do, and the compression loses.
Match how they carry a claim, not their subject matter.\n\n${b.exemplars.map((e, i) => `--- EXEMPLAR ${i + 1}: ${e.file} ---\n${e.text}`).join('\n\n')}\n=== END EXEMPLARS ===`
    : ''

  const stageBlock = c.stages
    ? `\n\nWork in three stages and do not skip to stage 2.

STAGE 1. Write the brief, under 150 words: Claim (the one sentence the reader should be able to say
afterwards), Evidence (the quantities with units and source), Mechanism (why it is true, not that it
is true), Decision (what changes because of this).

STAGE 2. Write the document from YOUR STAGE 1 BRIEF, not from the raw material above. Anything that
did not make your brief does not go in the document.

STAGE 3. Score your draft against the gate and revise: does sentence one state your claim; does every
claim resting on a quantity carry that quantity with its unit; does each paragraph open with its own
claim; does any paragraph carry two claims; are there any patterns from the negative set.

Output ONLY the finished document. Do not include your stage 1 brief or your stage 3 notes.`
    : '\n\nOutput ONLY the finished document.'

  const system = c.system ? `${c.system}\n\n---\n` : ''

  return agent(
    `${system}You are writing a ${b.genre.replace('_', ' ')} of about ${b.target_words} words.

=== RAW MATERIAL AND THE ASK ===
${b.prompt}
=== END ===
${exemplarBlock}${stageBlock}

Write the document, then save it with the Write tool to exactly this path:
  ${ROOT}/eval/outputs/${job.cond}/${b.id}.txt

Write the file in one go; it is short. Your final message should be the single word DONE and nothing
else - do not repeat the document back, because the file is the artifact.`,
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
