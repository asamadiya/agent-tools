import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  statSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { newRunId, newTaskId, slugifyWorkflowName } from "./ids.js";
import {
  DEFAULT_MODEL_CONFIG,
  WorkflowRunSchema,
  type WorkflowRun,
} from "./types.js";

const DEFAULT_ROOT = join(homedir(), ".copilot", "workflows");
let lastTimestampMs = 0;

export interface StateOptions {
  root?: string;
}

export interface WorkflowPathInput {
  root?: string;
  runId: string;
  workflowName: string;
}

export interface WorkflowPaths {
  root: string;
  runsDir: string;
  scriptsDir: string;
  transcriptDir: string;
  runPath: string;
  scriptPath: string;
  journalPath: string;
}

const nowIso = (): string => {
  const next = Math.max(Date.now(), lastTimestampMs + 1);
  lastTimestampMs = next;
  return new Date(next).toISOString();
};

const ensureDir = (path: string): void => {
  mkdirSync(path, { recursive: true });
};

const atomicWrite = (path: string, content: string): void => {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  const fd = openSync(tmp, "r");
  try {
    // Keep the temp file open long enough to ensure it exists before renaming.
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
};

export const workflowPaths = (input: WorkflowPathInput): WorkflowPaths => {
  const root = input.root ?? DEFAULT_ROOT;
  const runsDir = join(root, "runs");
  const scriptsDir = join(root, "scripts");
  const transcriptDir = join(root, "transcripts", input.runId);
  const slug = slugifyWorkflowName(input.workflowName);

  return {
    root,
    runsDir,
    scriptsDir,
    transcriptDir,
    runPath: join(runsDir, `${input.runId}.json`),
    scriptPath: join(scriptsDir, `${slug}-${input.runId}.js`),
    journalPath: join(transcriptDir, "journal.jsonl"),
  };
};

export interface CreateInitialRunInput extends StateOptions {
  workflowName: string;
  script: string;
  args?: unknown;
  phases?: WorkflowRun["phases"];
  resumeFromRunId?: string;
  budgetTokens?: number;
  defaultModel?: string;
  defaultEffort?: string;
  defaultContextWindow?: number;
}

export const createInitialRun = async (
  input: CreateInitialRunInput,
): Promise<WorkflowRun> => {
  const runId = newRunId();
  const paths = workflowPaths({ root: input.root, runId, workflowName: input.workflowName });
  ensureDir(paths.runsDir);
  ensureDir(paths.scriptsDir);
  ensureDir(paths.transcriptDir);
  writeFileSync(paths.scriptPath, input.script);

  const now = nowIso();
  const run: WorkflowRun = {
    runId,
    taskId: newTaskId(),
    workflowName: input.workflowName,
    status: "queued",
    script: input.script,
    scriptPath: paths.scriptPath,
    transcriptDir: paths.transcriptDir,
    ...(input.args !== undefined ? { args: input.args } : {}),
    ...(input.resumeFromRunId ? { resumeFromRunId: input.resumeFromRunId } : {}),
    ...(input.budgetTokens ? { budgetTokens: input.budgetTokens } : {}),
    defaultModel: input.defaultModel ?? DEFAULT_MODEL_CONFIG.model,
    defaultEffort: input.defaultEffort ?? DEFAULT_MODEL_CONFIG.effort,
    defaultContextWindow: input.defaultContextWindow ?? DEFAULT_MODEL_CONFIG.contextWindow,
    phases: input.phases ?? [],
    workflowProgress: [],
    cacheResults: [],
    result: null,
    error: null,
    agentCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    durationMs: 0,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
  };

  saveRun(run, { root: input.root });
  return run;
};

export const loadRun = (runId: string, opts: StateOptions = {}): WorkflowRun => {
  const root = opts.root ?? DEFAULT_ROOT;
  const path = join(root, "runs", `${runId}.json`);
  const raw = readFileSync(path, "utf8");
  return WorkflowRunSchema.parse(JSON.parse(raw));
};

export const saveRun = (run: WorkflowRun, opts: StateOptions = {}): void => {
  const paths = workflowPaths({ root: opts.root, runId: run.runId, workflowName: run.workflowName });
  const next = WorkflowRunSchema.parse({ ...run, updatedAt: nowIso() });
  atomicWrite(paths.runPath, `${JSON.stringify(next, null, 2)}\n`);
};

export const listRuns = (opts: StateOptions = {}): WorkflowRun[] => {
  const root = opts.root ?? DEFAULT_ROOT;
  const runsDir = join(root, "runs");
  if (!existsSync(runsDir)) return [];

  return readdirSync(runsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const path = join(runsDir, file);
      const stat = statSync(path, { bigint: true });
      return {
        run: WorkflowRunSchema.parse(JSON.parse(readFileSync(path, "utf8"))),
        birthtimeNs: stat.birthtimeNs,
        mtimeNs: stat.mtimeNs,
        file,
      };
    })
    .sort((a, b) => {
      const createdDiff = Date.parse(b.run.createdAt) - Date.parse(a.run.createdAt);
      if (createdDiff !== 0) return createdDiff;

      const updatedDiff = Date.parse(b.run.updatedAt) - Date.parse(a.run.updatedAt);
      if (updatedDiff !== 0) return updatedDiff;

      if (b.birthtimeNs !== a.birthtimeNs) {
        return b.birthtimeNs > a.birthtimeNs ? 1 : -1;
      }

      if (b.mtimeNs !== a.mtimeNs) {
        return b.mtimeNs > a.mtimeNs ? 1 : -1;
      }

      return b.file.localeCompare(a.file);
    })
    .map(({ run }) => run);
};

export const withRunLock = async <T>(
  runId: string,
  fn: () => Promise<T> | T,
  opts: StateOptions = {},
): Promise<T> => {
  const root = opts.root ?? DEFAULT_ROOT;
  const lockDir = join(root, "locks");
  ensureDir(lockDir);
  const lockTarget = join(lockDir, `${runId}.lock`);
  if (!existsSync(lockTarget)) writeFileSync(lockTarget, "");
  const release = await lockfile.lock(lockTarget, {
    stale: 30_000,
    realpath: false,
    retries: { retries: 20, minTimeout: 20, maxTimeout: 250 },
  });

  try {
    return await fn();
  } finally {
    await release();
  }
};

export const appendJournal = (runId: string, event: unknown, opts: StateOptions = {}): void => {
  const run = loadRun(runId, opts);
  const paths = workflowPaths({ root: opts.root, runId, workflowName: run.workflowName });
  ensureDir(paths.transcriptDir);
  appendFileSync(paths.journalPath, `${JSON.stringify(event)}\n`);
};

export const writeAgentTranscript = (
  runId: string,
  agentId: string,
  entries: unknown[],
  opts: StateOptions = {},
): void => {
  const run = loadRun(runId, opts);
  const paths = workflowPaths({ root: opts.root, runId, workflowName: run.workflowName });
  ensureDir(paths.transcriptDir);
  const path = join(paths.transcriptDir, `${agentId}.jsonl`);

  for (const entry of entries) {
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  }
};
