import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJournal,
  createInitialRun,
  listRuns,
  loadRun,
  saveRun,
  withRunLock,
  workflowPaths,
  writeAgentTranscript,
} from "../../src/state.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(process.cwd(), ".cw-state-"));
});

afterEach(() => {
  delete process.env.COPILOT_AGENT_SESSION_ID;
  delete process.env.TMUX_PANE;
  rmSync(root, { recursive: true, force: true });
});

describe("workflow state", () => {
  it("creates a run with script, run record, transcript dir, and defaults", async () => {
    process.env.COPILOT_AGENT_SESSION_ID = "session-state-test";
    process.env.TMUX_PANE = "%state-test";
    const run = await createInitialRun({
      root,
      workflowName: "demo-flow",
      script: "export const meta = { name: 'demo-flow', description: 'Demo' }",
      args: { topic: "readme" },
    });
    const paths = workflowPaths({ root, runId: run.runId, workflowName: run.workflowName });

    expect(run.status).toBe("queued");
    expect(run.defaultModel).toBe("gpt-5.5");
    expect(run.defaultEffort).toBe("xhigh");
    expect(run.defaultContextWindow).toBe(1_100_000);
    expect(run.owner).toMatchObject({
      sessionId: "session-state-test",
      tmuxPane: "%state-test",
    });
    expect(run.scriptPath).toBe(paths.scriptPath);
    expect(run.transcriptDir).toBe(paths.transcriptDir);
    expect(readFileSync(paths.scriptPath, "utf8")).toContain("export const meta");
    expect(loadRun(run.runId, { root }).runId).toBe(run.runId);
  });

  it("saves and reloads progress entries", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "progress-flow",
      script: "export const meta = { name: 'progress-flow', description: 'Demo' }",
    });
    run.status = "running";
    run.workflowProgress.push({ type: "workflow_phase", index: 1, title: "Read" });
    saveRun(run, { root });

    expect(loadRun(run.runId, { root }).workflowProgress).toEqual([
      { type: "workflow_phase", index: 1, title: "Read" },
    ]);
  });

  it("lists runs from newest to oldest", async () => {
    const first = await createInitialRun({
      root,
      workflowName: "first-flow",
      script: "export const meta = { name: 'first-flow', description: 'Demo' }",
    });
    const second = await createInitialRun({
      root,
      workflowName: "second-flow",
      script: "export const meta = { name: 'second-flow', description: 'Demo' }",
    });
    expect(listRuns({ root }).map((r) => r.runId)).toEqual([second.runId, first.runId]);
  });

  it("appends journal and transcript JSONL entries", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "journal-flow",
      script: "export const meta = { name: 'journal-flow', description: 'Demo' }",
    });
    appendJournal(run.runId, { type: "started", stepId: "step_1" }, { root });
    writeAgentTranscript(
      run.runId,
      "agent-a",
      [{ role: "assistant", content: "ok" }],
      { root },
    );

    const paths = workflowPaths({ root, runId: run.runId, workflowName: run.workflowName });
    expect(readFileSync(paths.journalPath, "utf8")).toContain("\"started\"");
    expect(readFileSync(join(paths.transcriptDir, "agent-a.jsonl"), "utf8")).toContain("\"ok\"");
  });

  it("serializes concurrent mutations with a per-run lock", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "lock-flow",
      script: "export const meta = { name: 'lock-flow', description: 'Demo' }",
    });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        withRunLock(
          run.runId,
          async () => {
            const current = loadRun(run.runId, { root });
            current.totalToolCalls += 1;
            appendJournal(run.runId, { type: "increment", index: i }, { root });
            saveRun(current, { root });
          },
          { root },
        ),
      ),
    );
    expect(loadRun(run.runId, { root }).totalToolCalls).toBe(5);
  });
});
