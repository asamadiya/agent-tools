import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentBackend } from "./agent-runtime.js";
import { CopilotPrintBackend } from "./agent-runtime.js";
import { extractWorkflowMeta, executeWorkflowScript, WorkflowExecutionError } from "./script.js";
import {
  appendJournal,
  createInitialRun,
  loadRun,
  saveRun,
  workflowPaths,
  writeAgentTranscript,
  type StateOptions,
} from "./state.js";
import type { ProgressReporter, WorkflowRun } from "./types.js";
import { noopProgress } from "./types.js";

export interface WorkflowRunnerOptions extends StateOptions {
  backend?: AgentBackend;
  progress?: ProgressReporter;
}

export interface WorkflowLaunchInput {
  script: string;
  args?: unknown;
  confirm?: boolean;
  resumeFromRunId?: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultContextWindow?: number;
  budgetTokens?: number;
}

export interface WorkflowLaunchOutput {
  taskId: string;
  runId: string;
  workflowName: string;
  status: WorkflowRun["status"];
  scriptPath: string;
  transcriptDir: string;
}

export interface WorkflowOutput {
  run: WorkflowRun;
  result: unknown;
  journal: string;
  transcripts: Array<{ agentId: string; path: string; content: string }>;
}

export class WorkflowRunner {
  private readonly backend: AgentBackend;
  private readonly progress: ProgressReporter;

  constructor(private readonly opts: WorkflowRunnerOptions = {}) {
    this.backend = opts.backend ?? new CopilotPrintBackend();
    this.progress = opts.progress ?? noopProgress;
  }

  async launch(input: WorkflowLaunchInput): Promise<WorkflowLaunchOutput> {
    if (input.confirm !== false) {
      throw new Error("Workflow launch requires confirmation; pass confirm:false only from trusted automation/tests");
    }
    const meta = extractWorkflowMeta(input.script);
    const run = await createInitialRun({
      root: this.opts.root,
      workflowName: meta.name,
      script: input.script,
      args: input.args,
      phases: meta.phases,
      ...(input.resumeFromRunId ? { resumeFromRunId: input.resumeFromRunId } : {}),
      ...(input.budgetTokens ? { budgetTokens: input.budgetTokens } : {}),
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      ...(input.defaultEffort ? { defaultEffort: input.defaultEffort } : {}),
      ...(input.defaultContextWindow ? { defaultContextWindow: input.defaultContextWindow } : {}),
    });
    appendJournal(run.runId, { type: "run_queued", runId: run.runId, taskId: run.taskId }, this.opts);
    return {
      taskId: run.taskId,
      runId: run.runId,
      workflowName: run.workflowName,
      status: run.status,
      scriptPath: run.scriptPath,
      transcriptDir: run.transcriptDir,
    };
  }

  async runToCompletion(runId: string): Promise<WorkflowRun> {
    let run = loadRun(runId, this.opts);
    if (run.status === "stopped") throw new Error(`workflow ${runId} is stopped`);
    const start = Date.now();
    run.status = "running";
    run.startedAt = new Date(start).toISOString();
    appendJournal(runId, { type: "run_started", runId }, this.opts);
    saveRun(run, this.opts);
    await this.progress(1, undefined, `workflow ${run.workflowName} started`);
    try {
      const out = await executeWorkflowScript(run.script, {
        args: run.args,
        backend: this.backend,
        defaultModel: run.defaultModel,
        defaultEffort: run.defaultEffort,
        defaultContextWindow: run.defaultContextWindow,
        maxRetries: 1,
        budgetTokens: run.budgetTokens,
      });
      run = loadRun(runId, this.opts);
      run.status = "completed";
      run.result = out.result;
      run.workflowProgress = out.progress;
      run.agentCount = out.agentCount;
      run.totalTokens = out.totalTokens;
      run.totalToolCalls = out.totalToolCalls;
      run.durationMs = Date.now() - start;
      run.completedAt = new Date().toISOString();
      appendJournal(runId, { type: "run_completed", result: out.result }, this.opts);
      for (const entry of out.progress) {
        if (entry.type === "workflow_agent") {
          writeAgentTranscript(runId, entry.agentId, [{ role: "assistant", content: entry.resultPreview ?? "" }], this.opts);
        }
      }
      saveRun(run, this.opts);
      await this.progress(2, undefined, `workflow ${run.workflowName} completed`);
      return run;
    } catch (err) {
      run = loadRun(runId, this.opts);
      run.status = "failed";
      run.error = err instanceof Error ? err.message : String(err);
      run.durationMs = Date.now() - start;
      run.completedAt = new Date().toISOString();
      if (err instanceof WorkflowExecutionError) {
        run.workflowProgress = err.progress;
        run.totalTokens = err.totalTokens;
        run.totalToolCalls = err.totalToolCalls;
        run.agentCount = err.agentCount;
      }
      appendJournal(runId, { type: "run_failed", error: run.error }, this.opts);
      saveRun(run, this.opts);
      throw err;
    }
  }

  status(runId: string): WorkflowRun {
    return loadRun(runId, this.opts);
  }

  output(runId: string): WorkflowOutput {
    const run = loadRun(runId, this.opts);
    const paths = workflowPaths({ root: this.opts.root, runId, workflowName: run.workflowName });
    const journal = existsSync(paths.journalPath) ? readFileSync(paths.journalPath, "utf8") : "";
    const transcripts = existsSync(paths.transcriptDir)
      ? readdirSync(paths.transcriptDir)
          .filter((f) => /^agent-.+\.jsonl$/.test(f))
          .map((f) => {
            const path = join(paths.transcriptDir, f);
            return { agentId: f.replace(/\.jsonl$/, ""), path, content: readFileSync(path, "utf8") };
          })
      : [];
    return { run, result: run.result, journal, transcripts };
  }

  stop(runId: string): WorkflowRun {
    const run = loadRun(runId, this.opts);
    if (run.status === "completed" || run.status === "failed") return run;
    run.status = "stopped";
    run.completedAt = new Date().toISOString();
    appendJournal(runId, { type: "run_stopped", runId }, this.opts);
    saveRun(run, this.opts);
    return loadRun(runId, this.opts);
  }
}
