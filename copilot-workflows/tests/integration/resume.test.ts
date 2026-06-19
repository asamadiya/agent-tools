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
});
