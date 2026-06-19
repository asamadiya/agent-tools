import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-reliability-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workflow reliability and visibility user stories", () => {
  it("shows stable labels and full output for a workflow: goal", async () => {
    const script = `
export const meta = { name: 'visibility', description: 'Visibility', phases: [{ title: 'Fanout' }] }
phase('Fanout')
const out = await parallel([
  () => agent('a', { label: 'reader:a', phase: 'Fanout' }),
  () => agent('b', { label: 'reader:b', phase: 'Fanout' }),
])
return { out }
`;
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A".repeat(500), tokens: 2, toolCalls: 1 },
        { text: "B".repeat(500), tokens: 2, toolCalls: 1 },
      ]),
    });
    const launch = await runner.launch({ script, confirm: false });
    await runner.runToCompletion(launch.runId);
    const output = runner.output(launch.runId);
    expect(JSON.stringify(output.result)).toContain("A".repeat(100));
    expect(output.run.workflowProgress.filter((p) => p.type === "workflow_agent").map((p) => p.label)).toEqual(["reader:a", "reader:b"]);
  });

  it("records failure instead of silently succeeding on budget overflow", async () => {
    const script = `
export const meta = { name: 'budget-fail', description: 'Budget fail' }
return await agent('too many tokens', { label: 'expensive' })
`;
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "huge", tokens: 10_000, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, confirm: false, budgetTokens: 1 });
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow();
    expect(runner.status(launch.runId).status).toBe("failed");
    expect(runner.status(launch.runId).error).toMatch(/budget/i);
  });
});
