import { slugifyWorkflowName } from "./ids.js";

const jsString = (s: string): string => JSON.stringify(s);

const cleanGoal = (goal: string): string => goal.replace(/^workflow:\s*/i, "").trim();

export const generateWorkflowScriptFromGoal = (goal: string): string => {
  const cleaned = cleanGoal(goal);
  const name = slugifyWorkflowName(cleaned).slice(0, 60);
  const desc = cleaned || "Run a dynamic workflow";
  return `export const meta = {
  name: ${jsString(name)},
  description: ${jsString(desc)},
  phases: [
    { title: 'Plan', detail: 'turn the user goal into concrete workflow tasks' },
    { title: 'Execute', detail: 'run task agents with isolated context' },
    { title: 'Synthesize', detail: 'merge task results into a final answer' },
  ],
}

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt'],
        properties: {
          label: { type: 'string' },
          prompt: { type: 'string' },
        },
      },
    },
  },
}

phase('Plan')
const plan = await agent(
  'Create 2-6 read-only or implementation-safe subagent tasks for this workflow goal. Return only JSON matching the schema. Goal: ' + ${jsString(desc)},
  { label: 'plan:tasks', phase: 'Plan', schema: TASK_SCHEMA },
)

phase('Execute')
const rawResults = await parallel(
  plan.tasks.map((task) => () => agent(task.prompt, { label: task.label, phase: 'Execute' })),
)
const results = rawResults.filter(Boolean)
log('completed ' + results.length + ' of ' + rawResults.length + ' planned tasks')

phase('Synthesize')
return await agent(
  'Synthesize these workflow results for the original goal: ' + ${jsString(desc)} + '\\n\\n' + JSON.stringify(results, null, 2),
  { label: 'synthesize:final', phase: 'Synthesize' },
)
`;
};
