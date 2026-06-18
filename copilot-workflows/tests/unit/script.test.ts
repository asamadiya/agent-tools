import { describe, expect, it } from "vitest";
import {
  extractWorkflowMeta,
  inspectWorkflowScript,
  stripMetaExport,
  validateDeterministicScript,
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

  it("rejects deterministic hazards", () => {
    expect(() => validateDeterministicScript(`${VALID}\nDate.now()`)).toThrow(/Date\.now/);
    expect(() => validateDeterministicScript(`${VALID}\nMath.random()`)).toThrow(/Math\.random/);
    expect(() => validateDeterministicScript(`${VALID}\nnew Date()`)).toThrow(/new Date/);
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
});
