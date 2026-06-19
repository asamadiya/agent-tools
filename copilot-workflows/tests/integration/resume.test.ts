import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-resume-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const script = `
export const meta = { name: 'resume-demo', description: 'Resume demo' }
const a = await agent('stable expensive', { label: 'stable', model: 'gpt-5.5', effort: 'xhigh' })
const b = await agent('format ' + a, { label: 'format', model: 'gpt-5.5', effort: 'xhigh' })
return { a, b }
`;

const edited = script.replace("format ' + a", "format edited ' + a");

describe("workflow resume cache", () => {
  it("replays same script with zero new backend calls", async () => {
    const first = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A", tokens: 10, toolCalls: 1 },
        { text: "B", tokens: 5, toolCalls: 1 },
      ]),
    });
    const launch = await first.launch({ script, confirm: false });
    await first.runToCompletion(launch.runId);

    const replay = new WorkflowRunner({ root, backend: new StubAgentBackend([]) });
    const replayLaunch = await replay.launch({ script, confirm: false, resumeFromRunId: launch.runId });
    const completed = await replay.runToCompletion(replayLaunch.runId);
    expect(completed.result).toEqual({ a: "A", b: "B" });
    expect(completed.totalTokens).toBe(0);
    expect(completed.workflowProgress.filter((p) => p.type === "workflow_agent").every((p) => p.state === "cached")).toBe(true);
  });

  it("chained resume stays fully cached with empty backend", async () => {
    const first = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A", tokens: 10, toolCalls: 1 },
        { text: "B", tokens: 5, toolCalls: 1 },
      ]),
    });
    const launch = await first.launch({ script, confirm: false });
    await first.runToCompletion(launch.runId);

    // First replay — fully cached; its cacheResults must be populated
    const replay1 = new WorkflowRunner({ root, backend: new StubAgentBackend([]) });
    const replayLaunch1 = await replay1.launch({ script, confirm: false, resumeFromRunId: launch.runId });
    const replay1Completed = await replay1.runToCompletion(replayLaunch1.runId);
    expect(replay1Completed.totalTokens).toBe(0);

    // Second replay from the first replay — must still be 100% cached with empty backend
    const replay2 = new WorkflowRunner({ root, backend: new StubAgentBackend([]) });
    const replayLaunch2 = await replay2.launch({ script, confirm: false, resumeFromRunId: replayLaunch1.runId });
    const replay2Completed = await replay2.runToCompletion(replayLaunch2.runId);
    expect(replay2Completed.result).toEqual({ a: "A", b: "B" });
    expect(replay2Completed.totalTokens).toBe(0);
    expect(
      replay2Completed.workflowProgress
        .filter((p) => p.type === "workflow_agent")
        .every((p) => p.state === "cached"),
    ).toBe(true);
  });

  it("keeps two identical agent() calls distinct in cache on resume", async () => {
    const dupScript = `
export const meta = { name: 'dup-demo', description: 'Duplicate prompts' }
const a = await agent('same prompt', { label: 'dup' })
const b = await agent('same prompt', { label: 'dup' })
return { a, b }
`;
    const first = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "FIRST", tokens: 4, toolCalls: 1 },
        { text: "SECOND", tokens: 4, toolCalls: 1 },
      ]),
    });
    const launch = await first.launch({ script: dupScript, confirm: false });
    const completed = await first.runToCompletion(launch.runId);
    expect(completed.result).toEqual({ a: "FIRST", b: "SECOND" });

    const replay = new WorkflowRunner({ root, backend: new StubAgentBackend([]) });
    const replayLaunch = await replay.launch({ script: dupScript, confirm: false, resumeFromRunId: launch.runId });
    const replayed = await replay.runToCompletion(replayLaunch.runId);
    expect(replayed.totalTokens).toBe(0);
    expect(replayed.result).toEqual({ a: "FIRST", b: "SECOND" });
    expect(
      replayed.workflowProgress
        .filter((p) => p.type === "workflow_agent")
        .every((p) => p.state === "cached"),
    ).toBe(true);
  });

  it("reruns from the first edited step onward", async () => {

    const first = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A", tokens: 10, toolCalls: 1 },
        { text: "B", tokens: 5, toolCalls: 1 },
      ]),
    });
    const launch = await first.launch({ script, confirm: false });
    await first.runToCompletion(launch.runId);

    const second = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "B2", tokens: 6, toolCalls: 1 }]),
    });
    const replayLaunch = await second.launch({ script: edited, confirm: false, resumeFromRunId: launch.runId });
    const completed = await second.runToCompletion(replayLaunch.runId);
    expect(completed.result).toEqual({ a: "A", b: "B2" });
    const agents = completed.workflowProgress.filter((p) => p.type === "workflow_agent");
    expect(agents.map((p) => p.state)).toEqual(["cached", "done"]);
  });

  it("resume after a failed run reuses cached completed agents", async () => {
    const twoStep = `
export const meta = { name: 'resume-after-fail', description: 'resume after failure' }
const a = await agent('first prompt', { label: 'first', model: 'gpt-5.5', effort: 'xhigh' })
const b = await agent('second prompt', { label: 'second', model: 'gpt-5.5', effort: 'xhigh' })
return { a, b }
`;
    const first = new WorkflowRunner({
      root,
      // Only one queued output: the second agent's backend call throws and fails the run.
      backend: new StubAgentBackend([{ text: "A", tokens: 10, toolCalls: 1 }]),
    });
    const launch = await first.launch({ script: twoStep, confirm: false });
    await expect(first.runToCompletion(launch.runId)).rejects.toThrow();
    expect(first.status(launch.runId).status).toBe("failed");

    const resume = new WorkflowRunner({
      root,
      // Only the second agent should run on resume; the first is cached.
      backend: new StubAgentBackend([{ text: "B", tokens: 5, toolCalls: 1 }]),
    });
    const resumeLaunch = await resume.launch({
      script: twoStep,
      confirm: false,
      resumeFromRunId: launch.runId,
    });
    const completed = await resume.runToCompletion(resumeLaunch.runId);
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ a: "A", b: "B" });
    const agents = completed.workflowProgress.filter((p) => p.type === "workflow_agent");
    expect(agents.map((p) => p.state)).toEqual(["cached", "done"]);
    expect(completed.totalTokens).toBe(5);
  });
});