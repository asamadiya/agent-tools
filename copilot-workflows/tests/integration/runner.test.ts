import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-runner-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const script = `
export const meta = {
  name: 'readme-demo',
  description: 'Read README',
  phases: [{ title: 'Read', detail: 'one read' }],
}
phase('Read')
const summary = await agent('read README', { label: 'read:README' })
return { summary }
`;

describe("WorkflowRunner", () => {
  it("launches, completes, and exposes status/output with transcripts", async () => {
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "README summary", tokens: 7, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, args: { topic: "readme" }, confirm: false });
    expect(launch.runId).toMatch(/^wf_/);
    expect(launch.scriptPath).toContain("readme-demo");
    expect(launch.transcriptDir).toContain(launch.runId);

    const completed = await runner.runToCompletion(launch.runId);
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ summary: "README summary" });

    const status = runner.status(launch.runId);
    expect(status.workflowProgress.some((p) => p.type === "workflow_agent" && p.label === "read:README")).toBe(true);

    const output = runner.output(launch.runId);
    expect(output.result).toEqual({ summary: "README summary" });
    expect(output.journal).toContain("run_started");
    expect(output.transcripts.length).toBe(1);
  });

  it("marks a queued run stopped before execution", async () => {
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "unused", tokens: 1, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, confirm: false });
    const stopped = runner.stop(launch.runId);
    expect(stopped.status).toBe("stopped");
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow(/stopped/);
  });

  it("failed run with budget overflow preserves partial workflowProgress, tokens, and agentCount", async () => {
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "README summary", tokens: 7, toolCalls: 1 }]),
    });
    const launch = await runner.launch({
      script,
      args: { topic: "readme" },
      confirm: false,
      budgetTokens: 3,
    });
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow(/budget exceeded/);

    const status = runner.status(launch.runId);
    expect(status.status).toBe("failed");
    expect(status.totalTokens).toBe(7);
    expect(status.agentCount).toBe(1);
    const failedStep = status.workflowProgress.find(
      (p) => p.type === "workflow_agent" && p.label === "read:README",
    );
    expect(failedStep).toBeDefined();
    expect((failedStep as Extract<typeof failedStep, { type: "workflow_agent" }>)?.state).toBe("failed");

    const out = runner.output(launch.runId);
    expect(out.run.status).toBe("failed");
    expect(out.run.error).toContain("budget exceeded");
    expect(out.run.totalTokens).toBe(7);
  });
});
