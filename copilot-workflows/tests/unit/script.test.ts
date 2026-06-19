import { describe, expect, it } from "vitest";
import {
  extractWorkflowMeta,
  inspectWorkflowScript,
  stripMetaExport,
  validateDeterministicScript,
  WorkflowExecutionError,
} from "../../src/script.js";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { executeWorkflowScript } from "../../src/script.js";

const VALID = `
export const meta = {
  name: 'readme-check',
  description: 'Read README and summarize',
  phases: [{ title: 'Read', detail: 'read files' }],
}

phase('Read')
return await agent('read README', { label: 'read:README' })
`;

describe("workflow script parser", () => {
  it("extracts pure literal meta and strips the export", () => {
    expect(extractWorkflowMeta(VALID)).toEqual({
      name: "readme-check",
      description: "Read README and summarize",
      phases: [{ title: "Read", detail: "read files" }],
    });
    expect(stripMetaExport(VALID).startsWith("phase('Read')")).toBe(true);
    expect(stripMetaExport(VALID)).not.toContain("],\n}");
  });

  it("rejects non-literal meta before runtime", () => {
    expect(() =>
      extractWorkflowMeta("const name = 'x'; export const meta = { name, description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { ...x, name: 'x', description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { name: makeName(), description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { name: `x`, description: 'bad' }"),
    ).toThrow(/pure literal/i);
  });

  it("handles braces inside string values in meta (regression: Bug B)", () => {
    const script = `
export const meta = { name: 'brace-test', description: 'fix the } bug' }
return null
`;
    expect(extractWorkflowMeta(script)).toEqual({ name: "brace-test", description: "fix the } bug", phases: [] });
    expect(stripMetaExport(script).trim()).toBe("return null");
  });

  it("rejects deterministic hazards", () => {
    expect(() => validateDeterministicScript(`${VALID}\nDate.now()`)).toThrow(/Date\.now/);
    expect(() => validateDeterministicScript(`${VALID}\nMath.random()`)).toThrow(/Math\.random/);
    expect(() => validateDeterministicScript(`${VALID}\nnew Date()`)).toThrow(/new Date/);
  });

  it("does not flag Math.random()/new Date() inside string literals (regression: Bug C)", () => {
    expect(() =>
      validateDeterministicScript(
        `${VALID}\nawait agent('compute the Math.random() distribution', {})`,
      ),
    ).not.toThrow();
    expect(() =>
      validateDeterministicScript(
        `${VALID}\nawait agent('compare new Date() output', {})`,
      ),
    ).not.toThrow();
    expect(() =>
      validateDeterministicScript(
        `${VALID}\nawait agent("use Date.now() for timing", {})`,
      ),
    ).not.toThrow();
  });

  it("still rejects actual Math.random()/new Date() API calls outside strings (regression: Bug C complement)", () => {
    expect(() =>
      validateDeterministicScript(`${VALID}\nconst x = Math.random()`),
    ).toThrow(/Math\.random/);
    expect(() =>
      validateDeterministicScript(`${VALID}\nconst d = new Date()`),
    ).toThrow(/new Date/);
    expect(() =>
      validateDeterministicScript(`${VALID}\nconst t = Date.now()`),
    ).toThrow(/Date\.now/);
  });

  it("returns inspection errors without throwing", () => {
    const out = inspectWorkflowScript("export const meta = { name: makeName(), description: 'bad' }");
    expect(out.valid).toBe(false);
    expect(out.errors.join("\n")).toMatch(/pure literal/i);
  });
});

describe("workflow runtime globals", () => {
  it("runs agent(), phase(), log(), args, and budget", async () => {
    const script = `
export const meta = { name: 'runtime', description: 'Runtime test', phases: [{ title: 'Read' }] }
phase('Read')
log('starting')
const one = await agent('hello ' + args.topic, { label: 'a' })
return { one, remaining: budget.remaining() }
`;
    const out = await executeWorkflowScript(script, {
      args: { topic: "world" },
      backend: new StubAgentBackend([{ text: "ok", tokens: 10, toolCalls: 1 }]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
      budgetTokens: 100,
    });
    expect(out.result).toEqual({ one: "ok", remaining: 90 });
    expect(out.progress.some((p) => p.type === "workflow_phase")).toBe(true);
    expect(out.progress.some((p) => p.type === "workflow_log")).toBe(true);
    expect(out.progress.some((p) => p.type === "workflow_agent")).toBe(true);
    const agentEntry = out.progress.find((p) => p.type === "workflow_agent");
    if (agentEntry?.type !== "workflow_agent") throw new Error("not an agent entry");
    expect(agentEntry.promptPreview).toBe("hello world");
  });

  it("parallel preserves order and converts thrown thunks to null", async () => {
    const script = `
export const meta = { name: 'parallel', description: 'Parallel test' }
const out = await parallel([
  () => agent('a', { label: 'a' }),
  () => { throw new Error('boom') },
  () => agent('b', { label: 'b' }),
])
return out
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([
        { text: "A", tokens: 1, toolCalls: 1 },
        { text: "B", tokens: 1, toolCalls: 1 },
      ]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual(["A", null, "B"]);
  });

  it("pipeline drops only the failed item", async () => {
    const script = `
export const meta = { name: 'pipe', description: 'Pipeline test' }
return await pipeline(
  ['a', 'bad', 'b'],
  async (item) => item === 'bad' ? (() => { throw new Error('bad item') })() : agent('stage1 ' + item, { label: 's1:' + item }),
  async (prev, original) => agent('stage2 ' + original + ':' + prev, { label: 's2:' + original }),
)
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([
        { text: "A1", tokens: 1, toolCalls: 1 },
        { text: "A2", tokens: 1, toolCalls: 1 },
        { text: "B1", tokens: 1, toolCalls: 1 },
        { text: "B2", tokens: 1, toolCalls: 1 },
      ]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual(["A2", null, "B2"]);
  });

  it("throws when budget is exceeded", async () => {
    const script = `
export const meta = { name: 'budget', description: 'Budget test' }
await agent('too much', { label: 'a' })
return true
`;
    await expect(
      executeWorkflowScript(script, {
        backend: new StubAgentBackend([{ text: "A", tokens: 101, toolCalls: 1 }]),
        defaultModel: "gpt-5.5",
        defaultEffort: "xhigh",
        defaultContextWindow: 1_100_000,
        maxRetries: 0,
        budgetTokens: 100,
      }),
    ).rejects.toThrow(/budget exceeded/i);
  });

  it("marks agent entry as failed with actual tokens and error when budget is exceeded", async () => {
    const script = `
export const meta = { name: 'budget-entry', description: 'Budget entry state test' }
await agent('too much', { label: 'over' })
return true
`;
    const err = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([{ text: "big result", tokens: 101, toolCalls: 2 }]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
      budgetTokens: 100,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkflowExecutionError);
    const workflowErr = err as WorkflowExecutionError;
    const agentEntry = workflowErr.progress.find((p) => p.type === "workflow_agent");
    expect(agentEntry).toBeDefined();
    if (agentEntry?.type !== "workflow_agent") throw new Error("not an agent entry");
    expect(agentEntry.state).toBe("failed");
    expect(agentEntry.error).toMatch(/budget exceeded/i);
    expect(agentEntry.tokens).toBe(101);
    expect(agentEntry.toolCalls).toBe(2);
    expect(agentEntry.retries).toBe(0);
    expect(agentEntry.resultPreview).toBeDefined();
  });

  it("cache key changes when workflow defaults change even if agent opts omit model/effort/context", async () => {
    const script = `
export const meta = { name: 'cachedefaults', description: 'Cache defaults test' }
await agent('hello', { label: 'a' })
return null
`;
    const base = {
      maxRetries: 0,
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
    };
    const out1 = await executeWorkflowScript(script, {
      ...base,
      backend: new StubAgentBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]),
      defaultModel: "gpt-5.5",
    });
    const out2 = await executeWorkflowScript(script, {
      ...base,
      backend: new StubAgentBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]),
      defaultModel: "claude-opus-4.8",
    });
    const key1 = out1.progress.find((p) => p.type === "workflow_agent");
    const key2 = out2.progress.find((p) => p.type === "workflow_agent");
    if (key1?.type !== "workflow_agent" || key2?.type !== "workflow_agent") throw new Error("not agent entries");
    expect(key1.cacheKey).toBeDefined();
    expect(key2.cacheKey).toBeDefined();
    expect(key1.cacheKey).not.toBe(key2.cacheKey);
  });

  it("uses phase model/effort/contextWindow when agent opts omit them", async () => {
    const script = `
export const meta = {
  name: 'phasemodel',
  description: 'Phase model test',
  phases: [{ title: 'Read', model: 'claude-opus-4.8', effort: 'high', contextWindow: 200000 }]
}
phase('Read')
await agent('hello', { label: 'a' })
return null
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    const agentEntry = out.progress.find((p) => p.type === "workflow_agent");
    if (agentEntry?.type !== "workflow_agent") throw new Error("not an agent entry");
    expect(agentEntry.model).toBe("claude-opus-4.8");
    expect(agentEntry.effort).toBe("high");
    expect(agentEntry.contextWindow).toBe(200_000);
  });

  it("parallel re-throws WorkflowExecutionError on budget overflow instead of returning null", async () => {
    const script = `
export const meta = { name: 'parallel-budget', description: 'Parallel budget overflow test' }
return await parallel([
  () => agent('a', { label: 'a' }),
  () => agent('b', { label: 'b' }),
])
`;
    await expect(
      executeWorkflowScript(script, {
        // First agent costs 3, second costs 5; total 8 > budget 5
        backend: new StubAgentBackend([
          { text: "A", tokens: 3, toolCalls: 1 },
          { text: "B", tokens: 5, toolCalls: 1 },
        ]),
        defaultModel: "gpt-5.5",
        defaultEffort: "xhigh",
        defaultContextWindow: 1_100_000,
        maxRetries: 0,
        budgetTokens: 5,
      }),
    ).rejects.toThrow(WorkflowExecutionError);
  });

  it("pipeline re-throws WorkflowExecutionError on budget overflow instead of returning null", async () => {
    const script = `
export const meta = { name: 'pipeline-budget', description: 'Pipeline budget overflow test' }
return await pipeline(
  ['x', 'y'],
  async (item) => agent('stage ' + item, { label: 's:' + item }),
)
`;
    await expect(
      executeWorkflowScript(script, {
        // Item 'x' costs 3, item 'y' costs 5; total 8 > budget 5
        backend: new StubAgentBackend([
          { text: "X", tokens: 3, toolCalls: 1 },
          { text: "Y", tokens: 5, toolCalls: 1 },
        ]),
        defaultModel: "gpt-5.5",
        defaultEffort: "xhigh",
        defaultContextWindow: 1_100_000,
        maxRetries: 0,
        budgetTokens: 5,
      }),
    ).rejects.toThrow(WorkflowExecutionError);
  });

  it("marks agent entry as failed (not running) when backend throws inside parallel (regression: Bug A)", async () => {
    const script = `
export const meta = { name: 'backend-err-parallel', description: 'Backend error in parallel test' }
return await parallel([
  () => agent('a', { label: 'good' }),
  () => agent('b', { label: 'bad' }),
])
`;
    // Supply only one output — the second backend call throws "no output queued"
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([{ text: "A", tokens: 1, toolCalls: 1 }]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual(["A", null]);
    const badEntry = out.progress.find((p) => p.type === "workflow_agent" && (p as Extract<typeof p, { type: "workflow_agent" }>).label === "bad");
    expect(badEntry).toBeDefined();
    if (badEntry?.type !== "workflow_agent") throw new Error("not an agent entry");
    expect(badEntry.state).toBe("failed");
    expect(badEntry.error).toBeDefined();
  });

  it("marks agent entry as failed (not running) when backend throws inside pipeline (regression: Bug A)", async () => {
    const script = `
export const meta = { name: 'backend-err-pipeline', description: 'Backend error in pipeline test' }
return await pipeline(
  ['a', 'b'],
  async (item) => agent('stage ' + item, { label: 's:' + item }),
)
`;
    // Supply only one output — the second backend call throws "no output queued"
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([{ text: "A", tokens: 1, toolCalls: 1 }]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual(["A", null]);
    const badEntry = out.progress.find((p) => p.type === "workflow_agent" && (p as Extract<typeof p, { type: "workflow_agent" }>).label === "s:b");
    expect(badEntry).toBeDefined();
    if (badEntry?.type !== "workflow_agent") throw new Error("not an agent entry");
    expect(badEntry.state).toBe("failed");
    expect(badEntry.error).toBeDefined();
  });

  it("does not expose Node globals (process/require/Buffer) to the workflow body", async () => {
    const script = `
export const meta = { name: 'sandbox', description: 'Sandbox test' }
return {
  process: typeof process,
  require: typeof require,
  buffer: typeof Buffer,
  json: typeof JSON,
  promise: typeof Promise,
}
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual({
      process: "undefined",
      require: "undefined",
      buffer: "undefined",
      json: "object",
      promise: "function",
    });
  });

  it("forwards systemPrompt/permissions/allowed/denied tools and isolation to the backend", async () => {
    class CapturingBackend {
      readonly inputs: Array<Record<string, unknown>> = [];
      constructor(private readonly outputs: Array<{ text: string; tokens: number; toolCalls: number }>) {}
      async run(input: Record<string, unknown>) {
        this.inputs.push(input);
        const out = this.outputs[this.inputs.length - 1];
        if (!out) throw new Error("no output queued");
        return out;
      }
    }
    const backend = new CapturingBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]);
    const script = `
export const meta = { name: 'forward', description: 'Forward options' }
return await agent('do it', {
  label: 'x',
  systemPrompt: 'be terse',
  permissions: 'plan',
  allowedTools: ['read', 'grep'],
  deniedTools: ['write'],
})
`;
    await executeWorkflowScript(script, {
      backend: backend as unknown as StubAgentBackend,
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(backend.inputs).toHaveLength(1);
    const captured = backend.inputs[0]!;
    expect(captured.systemPrompt).toBe("be terse");
    expect(captured.permissions).toBe("plan");
    expect(captured.allowedTools).toEqual(["read", "grep"]);
    expect(captured.deniedTools).toEqual(["write"]);
    expect(captured.isolation).toBe("none");
  });

  it("agent opts override phase model/effort/contextWindow", async () => {
    const script = `
export const meta = {
  name: 'phaseoverride',
  description: 'Phase override test',
  phases: [{ title: 'Read', model: 'claude-opus-4.8', effort: 'high', contextWindow: 200000 }]
}
phase('Read')
await agent('hello', { label: 'a', model: 'gpt-5.5', effort: 'xhigh', contextWindow: 1100000 })
return null
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]),
      defaultModel: "claude-opus-4.8",
      defaultEffort: "high",
      defaultContextWindow: 200_000,
      maxRetries: 0,
    });
    const agentEntry = out.progress.find((p) => p.type === "workflow_agent");
    if (agentEntry?.type !== "workflow_agent") throw new Error("not an agent entry");
    expect(agentEntry.model).toBe("gpt-5.5");
    expect(agentEntry.effort).toBe("xhigh");
    expect(agentEntry.contextWindow).toBe(1_100_000);
  });
});
