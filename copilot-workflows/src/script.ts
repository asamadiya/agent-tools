import vm from "node:vm";
import type { AgentBackend } from "./agent-runtime.js";
import { runAgentWithSchemaRetry, SchemaRetryError } from "./agent-runtime.js";
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

// Advance past a quoted string (single or double quote), returning the index after the closing quote.
const skipQuotedString = (script: string, i: number): number => {
  const q = script[i];
  i++;
  while (i < script.length) {
    if (script[i] === "\\") { i += 2; continue; }
    if (script[i] === q) return i + 1;
    i++;
  }
  return i;
};

// Walk a brace-delimited object literal starting at `start` (the opening `{`),
// correctly skipping over string literals so inner braces inside strings don't
// confuse the depth counter.
const walkBracedLiteral = (
  script: string,
  start: number,
): number | null => {
  let depth = 0;
  let i = start;
  while (i < script.length) {
    const ch = script[i];
    if (ch === '"' || ch === "'") {
      i = skipQuotedString(script, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return null;
};

const findMetaLiteral = (script: string): string | null => {
  const match = META_START_RE.exec(script);
  if (!match) return null;
  const start = match.index + match[0].length - 1; // index of opening {
  const end = walkBracedLiteral(script, start);
  if (end === null) return null;
  return script.slice(start, end + 1);
};

const findMetaSpan = (script: string): [number, number] | null => {
  const match = META_START_RE.exec(script);
  if (!match) return null;
  const literalStart = match.index + match[0].length - 1; // index of opening {
  const closingBrace = walkBracedLiteral(script, literalStart);
  if (closingBrace === null) return null;
  let end = closingBrace + 1;
  if (script.charAt(end) === ";") end++;
  while (end < script.length && /\s/.test(script.charAt(end))) end++;
  return [match.index, end];
};

const rejectNonLiteralMeta = (literal: string): void => {
  // Strip quoted string values before checking for forbidden structural patterns,
  // so goal text embedded in name/description (via JSON.stringify) doesn't
  // false-positive on word(, backticks, or ... that appear inside string values.
  const withoutStrings = literal
    .replace(/(['"])(?:\\.|(?!\1).)*\1\s*:/g, '"":')  // string object keys → keep the :
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');        // string values → ""

  const forbidden = [
    { re: /\.\.\./, name: "spread" },
    { re: /`/, name: "template string" },
    { re: /\b[a-zA-Z_$][\w$]*\s*\(/, name: "function call" },
  ];
  for (const f of forbidden) {
    if (f.re.test(withoutStrings)) throw new Error(`meta must be a pure literal; found ${f.name}`);
  }
  const withoutKeysAndStrings = withoutStrings
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
  // Strip string literals so prompt text containing API names doesn't false-positive.
  const stripped = script.replace(/(['"])(?:\\.|(?!\1).)*\1/gs, '""');
  const checks = [
    { re: /\bDate\.now\s*\(/, name: "Date.now" },
    { re: /\bMath\.random\s*\(/, name: "Math.random" },
    { re: /\bnew\s+Date\s*\(\s*\)/, name: "new Date()" },
    { re: /\brequire\s*\(/, name: "require()" },
    { re: /\bimport\s*\(/, name: "dynamic import()" },
  ];
  for (const check of checks) {
    if (check.re.test(stripped)) throw new Error(`workflow script uses nondeterministic or unavailable API: ${check.name}`);
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
  readonly transcripts: Array<{ agentId: string; transcript: unknown[] }>;
  readonly cacheResults: Array<{ cacheKey: string; result: unknown; progress: WorkflowProgressEntry }>;

  constructor(
    message: string,
    state: {
      progress: WorkflowProgressEntry[];
      totalTokens: number;
      totalToolCalls: number;
      agentCount: number;
      transcripts: Array<{ agentId: string; transcript: unknown[] }>;
      cacheResults: Array<{ cacheKey: string; result: unknown; progress: WorkflowProgressEntry }>;
    },
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
    this.progress = state.progress;
    this.totalTokens = state.totalTokens;
    this.totalToolCalls = state.totalToolCalls;
    this.agentCount = state.agentCount;
    this.transcripts = state.transcripts;
    this.cacheResults = state.cacheResults;
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
  previousCache?: Map<string, { result: unknown; progress: WorkflowProgressEntry }>;
}

export interface ExecuteWorkflowOutput {
  result: unknown;
  progress: WorkflowProgressEntry[];
  totalTokens: number;
  totalToolCalls: number;
  agentCount: number;
  cacheResults: Array<{ cacheKey: string; result: unknown; progress: WorkflowProgressEntry }>;
  transcripts: Array<{ agentId: string; transcript: unknown[] }>;
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

  const cacheResults: Array<{ cacheKey: string; result: unknown; progress: WorkflowProgressEntry }> = [];
  const transcripts: Array<{ agentId: string; transcript: unknown[] }> = [];

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
    // Fix (final review): include the 1-based call ordinal so two identical
    // agent() calls in one script do not collide on the same cache key.
    const cacheKey = agentCacheKey(prompt, opts, input.args, { model, effort, contextWindow }, index);

    const cached = input.previousCache?.get(cacheKey);
    if (cached) {
      const now = Date.now();
      const cachedEntry: WorkflowProgressEntry = {
        ...(cached.progress as Extract<WorkflowProgressEntry, { type: "workflow_agent" }>),
        index,
        stepId,
        label,
        agentId,
        // Use current call's phase context, not stale metadata from the prior run
        phaseIndex,
        phaseTitle,
        state: "cached" as const,
        tokens: 0,
        toolCalls: 0,
        durationMs: 0,
        updatedAt: now,
        completedAt: now,
      };
      progress.push(cachedEntry);
      // Carry cached entries forward so chained resumes can also replay from this run
      cacheResults.push({ cacheKey, result: cached.result, progress: cachedEntry });
      return cached.result;
    }

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
      promptPreview: prompt.slice(0, 500),
      cacheKey,
    };
    progress.push(entry);
    let out: Awaited<ReturnType<typeof runAgentWithSchemaRetry>>;
    try {
      out = await runAgentWithSchemaRetry(
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
          ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
          ...(opts.permissions ? { permissions: opts.permissions } : {}),
          ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
          ...(opts.deniedTools ? { deniedTools: opts.deniedTools } : {}),
          isolation: opts.isolation,
        },
        input.backend,
        { maxRetries: input.maxRetries },
      );
    } catch (backendErr) {
      const now = Date.now();
      Object.assign(entry, {
        updatedAt: now,
        completedAt: now,
        durationMs: now - startedAt,
        state: "failed",
        error: backendErr instanceof Error ? backendErr.message : String(backendErr),
      });
      // Capture the failed agent's attempted transcript (schema failures carry the
      // malformed attempts) so it persists alongside prior completed agents.
      if (backendErr instanceof SchemaRetryError && backendErr.transcript.length > 0) {
        transcripts.push({ agentId, transcript: backendErr.transcript });
      }
      throw backendErr;
    }
    totalTokens += out.tokens;
    totalToolCalls += out.toolCalls;
    // Capture the full transcript before any budget check so even a
    // budget-overflow failure (where the backend already returned) is recorded.
    transcripts.push({ agentId, transcript: out.transcript });
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
      throw new WorkflowExecutionError(msg, {
        progress,
        totalTokens,
        totalToolCalls,
        agentCount: agentIndex,
        transcripts,
        cacheResults,
      });
    }
    Object.assign(entry, { ...completedFields, state: "done" });
    cacheResults.push({ cacheKey, result: out.result, progress: entry });
    return out.result;
  };

  const parallel = async (
    thunks: Array<() => unknown | Promise<unknown>>,
  ): Promise<unknown[]> =>
    Promise.all(
      thunks.map(async (thunk) => {
        try {
          return await thunk();
        } catch (err) {
          if (err instanceof WorkflowExecutionError) throw err;
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
      } catch (err) {
        if (err instanceof WorkflowExecutionError) throw err;
        results.push(null);
      }
    }
    return results;
  };

  const runnerContext = vm.createContext({
    agent,
    parallel,
    pipeline,
    phase,
    log,
    args: input.args,
    budget,
  });
  const wrapped = `"use strict";\n(async () => {\n${body}\n})()`;
  let result: unknown;
  try {
    result = await (vm.runInContext(wrapped, runnerContext, {
      filename: "workflow-body.js",
    }) as Promise<unknown>);
  } catch (err) {
    // Wrap any agent() failure (backend error, schema-retry exhaustion, etc.) that
    // propagates out of the workflow body into a workflow-level error carrying the
    // current progress, totals, agent count, transcripts, and cache results so the
    // runner can persist them and resume can reuse prior completed agents.
    if (err instanceof WorkflowExecutionError) throw err;
    throw new WorkflowExecutionError(err instanceof Error ? err.message : String(err), {
      progress,
      totalTokens,
      totalToolCalls,
      agentCount: agentIndex,
      transcripts,
      cacheResults,
    });
  }
  return { result, progress, totalTokens, totalToolCalls, agentCount: agentIndex, cacheResults, transcripts };
};
