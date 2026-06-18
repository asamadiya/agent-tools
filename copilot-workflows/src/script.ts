import vm from "node:vm";
import type { AgentBackend } from "./agent-runtime.js";
import { runAgentWithSchemaRetry } from "./agent-runtime.js";
import { agentCacheKey } from "./cache.js";
import { newAgentId } from "./ids.js";
import { WorkflowMetaSchema, type WorkflowMeta, AgentStepOptionsSchema, type WorkflowProgressEntry } from "./types.js";

export interface WorkflowInspection {
  valid: boolean;
  meta: WorkflowMeta | null;
  errors: string[];
  warnings: string[];
}

const META_START_RE = /export\s+const\s+meta\s*=\s*({)/m;

const findMetaLiteral = (script: string): string | null => {
  const match = META_START_RE.exec(script);
  if (!match) return null;
  const start = match.index + match[0].length - 1; // index of opening {
  let depth = 0;
  for (let i = start; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}") {
      depth--;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  return null;
};

const findMetaSpan = (script: string): [number, number] | null => {
  const match = META_START_RE.exec(script);
  if (!match) return null;
  const literalStart = match.index + match[0].length - 1; // index of opening {
  let depth = 0;
  for (let i = literalStart; i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}") {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        if (script.charAt(end) === ";") end++;
        while (end < script.length && /\s/.test(script.charAt(end))) end++;
        return [match.index, end];
      }
    }
  }
  return null;
};

const rejectNonLiteralMeta = (literal: string): void => {
  const forbidden = [
    { re: /\.\.\./, name: "spread" },
    { re: /`/, name: "template string" },
    { re: /\b[a-zA-Z_$][\w$]*\s*\(/, name: "function call" },
  ];
  for (const f of forbidden) {
    if (f.re.test(literal)) throw new Error(`meta must be a pure literal; found ${f.name}`);
  }
  const withoutKeysAndStrings = literal
    .replace(/(['"])(?:\\.|(?!\1).)*\1\s*:/g, "")
    .replace(/[a-zA-Z_$][\w$]*\s*:/g, "")
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\b(true|false|null)\b/g, "");
  if (/[a-zA-Z_$][\w$]*/.test(withoutKeysAndStrings)) {
    throw new Error("meta must be a pure literal; found identifier reference");
  }
};

export const extractWorkflowMeta = (script: string): WorkflowMeta => {
  const literal = findMetaLiteral(script);
  if (!literal) throw new Error("workflow script must start with export const meta = { ... }");
  rejectNonLiteralMeta(literal);
  const context = vm.createContext(Object.freeze({}));
  const parsed = vm.runInContext(`(${literal})`, context, { timeout: 1000 });
  return WorkflowMetaSchema.parse(parsed);
};

export const stripMetaExport = (script: string): string => {
  const span = findMetaSpan(script);
  if (!span) return script.trim();
  const [start, end] = span;
  return `${script.slice(0, start)}${script.slice(end)}`.trim();
};

export const validateDeterministicScript = (script: string): void => {
  const checks = [
    { re: /\bDate\.now\s*\(/, name: "Date.now" },
    { re: /\bMath\.random\s*\(/, name: "Math.random" },
    { re: /\bnew\s+Date\s*\(\s*\)/, name: "new Date()" },
    { re: /\brequire\s*\(/, name: "require()" },
    { re: /\bimport\s*\(/, name: "dynamic import()" },
  ];
  for (const check of checks) {
    if (check.re.test(script)) throw new Error(`workflow script uses nondeterministic or unavailable API: ${check.name}`);
  }
};

export const inspectWorkflowScript = (script: string): WorkflowInspection => {
  const errors: string[] = [];
  let meta: WorkflowMeta | null = null;
  try {
    meta = extractWorkflowMeta(script);
    validateDeterministicScript(script);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return { valid: errors.length === 0, meta, errors, warnings: [] };
};

export class WorkflowExecutionError extends Error {
  readonly progress: WorkflowProgressEntry[];
  readonly totalTokens: number;
  readonly totalToolCalls: number;
  readonly agentCount: number;

  constructor(
    message: string,
    state: {
      progress: WorkflowProgressEntry[];
      totalTokens: number;
      totalToolCalls: number;
      agentCount: number;
    },
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
    this.progress = state.progress;
    this.totalTokens = state.totalTokens;
    this.totalToolCalls = state.totalToolCalls;
    this.agentCount = state.agentCount;
  }
}

export interface ExecuteWorkflowInput {
  args?: unknown;
  backend: AgentBackend;
  defaultModel: string;
  defaultEffort: string;
  defaultContextWindow: number;
  maxRetries: number;
  budgetTokens?: number;
}

export interface ExecuteWorkflowOutput {
  result: unknown;
  progress: WorkflowProgressEntry[];
  totalTokens: number;
  totalToolCalls: number;
  agentCount: number;
}

type PhaseEntry = Extract<WorkflowProgressEntry, { type: "workflow_phase" }>;

export const executeWorkflowScript = async (
  script: string,
  input: ExecuteWorkflowInput,
): Promise<ExecuteWorkflowOutput> => {
  const meta = extractWorkflowMeta(script);
  validateDeterministicScript(script);
  const body = stripMetaExport(script);

  const progress: WorkflowProgressEntry[] = meta.phases.map(
    (p, i): WorkflowProgressEntry => ({
      type: "workflow_phase",
      index: i + 1,
      title: p.title,
      ...(p.detail !== undefined ? { detail: p.detail } : {}),
    }),
  );

  let currentPhase: string | null = null;
  let logIndex = 0;
  let agentIndex = 0;
  let totalTokens = 0;
  let totalToolCalls = 0;

  const budgetTotal = input.budgetTokens ?? Number.POSITIVE_INFINITY;
  const budget = {
    total: budgetTotal,
    spent: () => totalTokens,
    remaining: () => Math.max(0, budgetTotal - totalTokens),
  };

  const getPhases = (): PhaseEntry[] =>
    progress.filter((p): p is PhaseEntry => p.type === "workflow_phase");

  const phase = (title: string): void => {
    currentPhase = title;
    const phases = getPhases();
    if (!phases.some((p) => p.title === title)) {
      progress.push({ type: "workflow_phase", index: phases.length + 1, title });
    }
  };

  const log = (message: string): void => {
    progress.push({
      type: "workflow_log",
      index: logIndex++,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  const agent = async (prompt: string, rawOpts: unknown = {}): Promise<unknown> => {
    const opts = AgentStepOptionsSchema.parse(rawOpts);
    const index = ++agentIndex;
    const agentId = newAgentId();
    const label = opts.label ?? `agent:${index}`;
    const phaseTitle = opts.phase ?? currentPhase ?? undefined;
    const phases = getPhases();
    const rawPhaseIndex = phaseTitle
      ? phases.findIndex((p) => p.title === phaseTitle) + 1
      : 0;
    const phaseIndex = rawPhaseIndex > 0 ? rawPhaseIndex : undefined;
    // Fix 3: resolve model/effort/contextWindow via opts → phase defaults → global defaults
    const phaseConfig = phaseTitle ? meta.phases.find((p) => p.title === phaseTitle) : undefined;
    const model = opts.model ?? phaseConfig?.model ?? input.defaultModel;
    const effort = opts.effort ?? phaseConfig?.effort ?? input.defaultEffort;
    const contextWindow = opts.contextWindow ?? phaseConfig?.contextWindow ?? input.defaultContextWindow;
    const stepId = `step_${index}`;
    // Fix 2: include effective model/effort/contextWindow in cache key
    const cacheKey = agentCacheKey(prompt, opts, input.args, { model, effort, contextWindow });
    const startedAt = Date.now();
    const entry: WorkflowProgressEntry = {
      type: "workflow_agent",
      index,
      stepId,
      label,
      ...(phaseIndex !== undefined ? { phaseIndex } : {}),
      ...(phaseTitle !== undefined ? { phaseTitle } : {}),
      agentId,
      model,
      effort,
      contextWindow,
      state: "running",
      queuedAt: startedAt,
      startedAt,
      updatedAt: startedAt,
      attempt: 1,
      tokens: 0,
      toolCalls: 0,
      retries: 0,
      cacheKey,
    };
    progress.push(entry);
    const out = await runAgentWithSchemaRetry(
      {
        prompt,
        stepId,
        agentId,
        model,
        effort,
        contextWindow,
        ...(opts.schema ? { schema: opts.schema } : {}),
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
      },
      input.backend,
      { maxRetries: input.maxRetries },
    );
    totalTokens += out.tokens;
    totalToolCalls += out.toolCalls;
    const now = Date.now();
    const completedFields = {
      updatedAt: now,
      completedAt: now,
      durationMs: now - startedAt,
      tokens: out.tokens,
      toolCalls: out.toolCalls,
      retries: out.retries,
      ...(out.lastToolName ? { lastToolName: out.lastToolName } : {}),
      ...(out.lastToolSummary ? { lastToolSummary: out.lastToolSummary } : {}),
      resultPreview:
        typeof out.result === "string"
          ? out.result.slice(0, 200)
          : JSON.stringify(out.result).slice(0, 200),
    };
    // Fix 1: update entry to failed state with actual metrics before throwing on budget exceeded
    if (totalTokens > budgetTotal) {
      const msg = `workflow budget exceeded: spent ${totalTokens}, budget ${budgetTotal}`;
      Object.assign(entry, { ...completedFields, state: "failed", error: msg });
      throw new WorkflowExecutionError(msg, { progress, totalTokens, totalToolCalls, agentCount: agentIndex });
    }
    Object.assign(entry, { ...completedFields, state: "done" });
    return out.result;
  };

  const parallel = async (
    thunks: Array<() => unknown | Promise<unknown>>,
  ): Promise<unknown[]> =>
    Promise.all(
      thunks.map(async (thunk) => {
        try {
          return await thunk();
        } catch {
          return null;
        }
      }),
    );

  // Sequential: each item runs all stages before the next item starts,
  // ensuring backend stub calls follow a predictable item-by-item order.
  const pipeline = async (
    items: unknown[],
    ...stages: Array<(prev: unknown, original: unknown, index: number) => unknown | Promise<unknown>>
  ): Promise<unknown[]> => {
    const results: unknown[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let current: unknown = item;
      try {
        for (const stage of stages) {
          current = await stage(current, item, i);
        }
        results.push(current);
      } catch {
        results.push(null);
      }
    }
    return results;
  };

  const runner = new Function(
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "args",
    "budget",
    `"use strict"; return (async () => {\n${body}\n})()`,
  );

  const result = await (runner(agent, parallel, pipeline, phase, log, input.args, budget) as Promise<unknown>);
  return { result, progress, totalTokens, totalToolCalls, agentCount: agentIndex };
};
