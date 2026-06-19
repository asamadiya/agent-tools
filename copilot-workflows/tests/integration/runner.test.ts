import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentBackend, BackendRawOutput } from "../../src/agent-runtime.js";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";
import type { WorkflowProgressEntry } from "../../src/types.js";

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

  it("persists full per-agent transcripts (not truncated previews)", async () => {
    const longScript = `
export const meta = { name: 'long-demo', description: 'Long output' }
return await agent('produce a long answer', { label: 'long' })
`;
    const big = "A".repeat(500);
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: big, tokens: 5, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script: longScript, confirm: false });
    await runner.runToCompletion(launch.runId);

    const output = runner.output(launch.runId);
    expect(output.transcripts.length).toBe(1);
    expect(output.transcripts[0]!.content.length).toBeGreaterThan(200);
    expect(output.transcripts[0]!.content).toContain(big);
  });

  it("persists the transcript even when a run fails on budget overflow", async () => {
    const longScript = `
export const meta = { name: 'budget-transcript', description: 'Budget overflow transcript' }
return await agent('produce a long answer', { label: 'long' })
`;
    const big = "B".repeat(500);
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: big, tokens: 10, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script: longScript, confirm: false, budgetTokens: 1 });
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow(/budget/i);

    const output = runner.output(launch.runId);
    expect(output.run.status).toBe("failed");
    expect(output.transcripts.length).toBe(1);
    expect(output.transcripts[0]!.content).toContain(big);
  });

  it("marks a queued run stopped before execution", async () => {
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "unused", tokens: 1, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, confirm: false });
    const stopped = await runner.stop(launch.runId);
    expect(stopped.status).toBe("stopped");
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow(/stopped/);
  });

  it("preserves a stopped state when stop wins the race during execution", async () => {
    let releaseBackend!: (out: BackendRawOutput) => void;
    let signalCalled!: () => void;
    const calledPromise = new Promise<void>((resolve) => {
      signalCalled = resolve;
    });
    const deferred = new Promise<BackendRawOutput>((resolve) => {
      releaseBackend = resolve;
    });
    const backend: AgentBackend = {
      run() {
        signalCalled();
        return deferred;
      },
    };
    const runner = new WorkflowRunner({ root, backend });
    const launch = await runner.launch({ script, confirm: false });

    const running = runner.runToCompletion(launch.runId);
    await calledPromise; // agent is mid-flight, runner holds no lock

    const stopped = await runner.stop(launch.runId);
    expect(stopped.status).toBe("stopped");

    releaseBackend({ text: "late result", tokens: 1, toolCalls: 1 });
    const final = await running;
    expect(final.status).toBe("stopped");
    expect(runner.status(launch.runId).status).toBe("stopped");
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

  it("persists progress, transcripts, and cacheResults when a later agent fails (non-budget)", async () => {
    const twoStep = `
export const meta = { name: 'fail-after-success', description: 'second agent fails' }
const a = await agent('first prompt', { label: 'first' })
const b = await agent('second prompt', { label: 'second' })
return { a, b }
`;
    const runner = new WorkflowRunner({
      root,
      // Only one queued output: the second agent's backend call throws.
      backend: new StubAgentBackend([{ text: "FIRST OUTPUT", tokens: 4, toolCalls: 2 }]),
    });
    const launch = await runner.launch({ script: twoStep, confirm: false });
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow();

    const status = runner.status(launch.runId);
    expect(status.status).toBe("failed");
    expect(status.agentCount).toBe(2);
    expect(status.totalTokens).toBe(4);
    expect(status.totalToolCalls).toBe(2);

    const first = status.workflowProgress.find(
      (p) => p.type === "workflow_agent" && p.label === "first",
    ) as Extract<WorkflowProgressEntry, { type: "workflow_agent" }> | undefined;
    const second = status.workflowProgress.find(
      (p) => p.type === "workflow_agent" && p.label === "second",
    ) as Extract<WorkflowProgressEntry, { type: "workflow_agent" }> | undefined;
    expect(first?.state).toBe("done");
    expect(second?.state).toBe("failed");

    // The first (completed) agent's cache result persists for resume.
    expect(status.cacheResults.length).toBe(1);

    const out = runner.output(launch.runId);
    const firstTranscript = out.transcripts.find((t) => t.content.includes("FIRST OUTPUT"));
    expect(firstTranscript).toBeDefined();
  });

  it("preserves stopped status but persists cacheResults from a completed execution race", async () => {
    let releaseBackend!: (out: BackendRawOutput) => void;
    let signalCalled!: () => void;
    const calledPromise = new Promise<void>((resolve) => {
      signalCalled = resolve;
    });
    const deferred = new Promise<BackendRawOutput>((resolve) => {
      releaseBackend = resolve;
    });
    const backend: AgentBackend = {
      run() {
        signalCalled();
        return deferred;
      },
    };
    const runner = new WorkflowRunner({ root, backend });
    const launch = await runner.launch({ script, confirm: false });

    const running = runner.runToCompletion(launch.runId);
    await calledPromise;
    const stopped = await runner.stop(launch.runId);
    expect(stopped.status).toBe("stopped");

    releaseBackend({ text: "late result", tokens: 3, toolCalls: 1 });
    const final = await running;
    expect(final.status).toBe("stopped");

    const persisted = runner.status(launch.runId);
    expect(persisted.status).toBe("stopped");
    expect(persisted.cacheResults.length).toBe(1);

    // Resume from the stopped run should fully reuse the cached agent.
    const resume = new WorkflowRunner({ root, backend: new StubAgentBackend([]) });
    const resumeLaunch = await resume.launch({
      script,
      confirm: false,
      resumeFromRunId: launch.runId,
    });
    const completed = await resume.runToCompletion(resumeLaunch.runId);
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ summary: "late result" });
    expect(completed.totalTokens).toBe(0);
  });
});
