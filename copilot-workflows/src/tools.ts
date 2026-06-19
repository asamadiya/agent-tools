import { z } from "zod";
import { logger } from "./logger.js";
import { inspectWorkflowScript } from "./script.js";
import { WorkflowRunner, type WorkflowRunnerOptions } from "./runner.js";
import { generateWorkflowScriptFromGoal } from "./planner.js";
import { listRuns } from "./state.js";
import {
  renderProgressTree,
  renderWorkflowDetail,
  renderWorkflowList,
  workflowIdForRun,
  workflowListItems,
} from "./visibility.js";

export const WorkflowInputSchema = z.object({
  script: z.string().optional(),
  scriptPath: z.string().optional(),
  goal: z.string().optional(),
  args: z.unknown().optional(),
  confirm: z.boolean().default(true),
  wait: z.boolean().default(false),
  resumeFromRunId: z.string().optional(),
});

export const WorkflowRunIdSchema = z.object({
  runId: z.string().min(1),
  selectedPhase: z.string().optional(),
  selectedAgent: z.string().optional(),
});
export const WorkflowInspectInputSchema = z.object({ script: z.string() });
export const WorkflowListInputSchema = z.object({
  status: z.enum(["preview", "queued", "running", "completed", "failed", "stopped"]).optional(),
  workflowName: z.string().optional(),
});
export const WorkflowSaveInputSchema = z.object({
  script: z.string(),
  args: z.unknown().optional(),
});

export const handleWorkflow = async (raw: unknown, deps: WorkflowRunnerOptions) => {
  const input = WorkflowInputSchema.parse(raw);
  const script = input.script ?? (input.goal ? generateWorkflowScriptFromGoal(input.goal) : undefined);
  if (!script) throw new Error("Workflow requires script or goal");
  const runner = new WorkflowRunner(deps);
  const launch = await runner.launch({
    script,
    args: input.args,
    confirm: input.confirm,
    ...(input.resumeFromRunId ? { resumeFromRunId: input.resumeFromRunId } : {}),
  });
  const launchedRun = runner.status(launch.runId);
  const launchRuns = listRuns({ root: deps.root });
  const launchWorkflowId = workflowIdForRun(launchedRun, launchRuns);
  const launchUx = {
    workflowId: launchWorkflowId,
    workflowList: workflowListItems(launchRuns),
    workflowListText: renderWorkflowList(launchRuns, launch.runId),
    detailView: renderWorkflowDetail(launchedRun, { workflowId: launchWorkflowId }),
  };
  if (!input.wait) {
    // Schedule the run in-process and return immediately. Errors are captured
    // and persisted via runToCompletion's failure path; log them here too.
    void runner.runToCompletion(launch.runId).catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), runId: launch.runId },
        "background workflow run failed",
      );
    });
    return { ...launch, ...launchUx, status: "async_launched" as const };
  }
  const done = await runner.runToCompletion(launch.runId);
  const doneRuns = listRuns({ root: deps.root });
  const doneWorkflowId = workflowIdForRun(done, doneRuns);
  return {
    ...launch,
    workflowId: doneWorkflowId,
    workflowList: workflowListItems(doneRuns),
    workflowListText: renderWorkflowList(doneRuns, done.runId),
    detailView: renderWorkflowDetail(done, { workflowId: doneWorkflowId }),
    status: done.status,
    result: done.result,
    workflowProgress: done.workflowProgress,
  };
};

export const handleWorkflowStatus = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const { runId, selectedPhase, selectedAgent } = WorkflowRunIdSchema.parse(raw);
  const runner = new WorkflowRunner(deps);
  const run = runner.status(runId);
  const runs = listRuns({ root: deps.root });
  const workflowId = workflowIdForRun(run, runs);
  return {
    run,
    workflowId,
    workflowList: workflowListItems(runs),
    workflowListText: renderWorkflowList(runs, runId),
    progressTree: renderProgressTree(run),
    detailView: renderWorkflowDetail(run, { workflowId, selectedPhase, selectedAgent }),
  };
};

export const handleWorkflowOutput = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const { runId } = WorkflowRunIdSchema.parse(raw);
  const output = new WorkflowRunner(deps).output(runId);
  const runs = listRuns({ root: deps.root });
  const workflowId = workflowIdForRun(output.run, runs);
  return {
    ...output,
    workflowId,
    detailView: renderWorkflowDetail(output.run, { workflowId }),
  };
};

export const handleWorkflowStop = async (raw: unknown, deps: WorkflowRunnerOptions) => {
  const { runId } = WorkflowRunIdSchema.parse(raw);
  return new WorkflowRunner(deps).stop(runId);
};

export const handleWorkflowInspect = (raw: unknown) => {
  const { script } = WorkflowInspectInputSchema.parse(raw);
  return inspectWorkflowScript(script);
};

export const handleWorkflowList = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const input = WorkflowListInputSchema.parse(raw);
  const runs = listRuns({ root: deps.root }).filter((run) => {
    if (input.status && run.status !== input.status) return false;
    if (input.workflowName && run.workflowName !== input.workflowName) return false;
    return true;
  });
  return { runs, workflowList: workflowListItems(runs), workflowListText: renderWorkflowList(runs) };
};

export const handleWorkflowSave = async (raw: unknown, deps: WorkflowRunnerOptions) => {
  const input = WorkflowSaveInputSchema.parse(raw);
  const inspection = inspectWorkflowScript(input.script);
  if (!inspection.valid || !inspection.meta) return inspection;
  const launch = await new WorkflowRunner(deps).launch({
    script: input.script,
    args: input.args,
    confirm: false,
  });
  return { ...inspection, saved: true, ...launch };
};
