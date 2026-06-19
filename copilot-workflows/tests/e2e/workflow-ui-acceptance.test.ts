import { execa } from "execa";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let sessionName: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "cw-ui-accept-"));
  sessionName = `cw-ui-${process.pid}-${Date.now()}`;
  seedRuns(root);
  await execa("tmux", ["new-session", "-d", "-s", sessionName, "-x", "140", "-y", "40"]);
});

afterEach(async () => {
  await execa("tmux", ["kill-session", "-t", sessionName], { reject: false });
  rmSync(root, { recursive: true, force: true });
});

describe("interactive workflow UI acceptance", () => {
  it("navigates workflow -> phase -> task -> task details with arrow keys and scrolls details with vim keys", async () => {
    await startUi();

    await send("Right");
    await send("Down");
    await expectPaneToContain("Phase outcome: Execute completed 2/2 tasks");
    await expectPaneToContain("task-a: outcome A");
    await expectPaneToContain("task-b: outcome B");

    await send("Right");
    await send("Down");
    await expectPaneToContain("❯ ✔ task-b");
    await expectPaneToContain("Prompt: prompt B");
    await expectPaneToContain("Outcome: outcome B");

    await send("Right");
    await expectPaneToContain("Agent details");
    await expectPaneToContain("Prompt: prompt B");
    await expectPaneToContain("Outcome: outcome B");

    await send("j");
    await expectPaneToContain("Activity: ToolB");
    await send("k");
    await expectPaneToContain("Prompt: prompt B");
  });
});

const startUi = async () => {
  await execa("tmux", [
    "send-keys",
    "-t",
    sessionName,
    `cd ${process.cwd()} && COPILOT_WORKFLOWS_ROOT=${root} node dist/cli.js ui`,
    "Enter",
  ]);
  await expectPaneToContain("WF1");
};

const send = async (key: string) => {
  await execa("tmux", ["send-keys", "-t", sessionName, key]);
  await new Promise((resolve) => setTimeout(resolve, 100));
};

const capture = async (): Promise<string> =>
  (await execa("tmux", ["capture-pane", "-p", "-t", sessionName, "-S", "-"])).stdout;

const expectPaneToContain = async (text: string) => {
  for (let i = 0; i < 20; i++) {
    const out = await capture();
    if (out.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(await capture()).toContain(text);
};

const seedRuns = (dir: string) => {
  mkdirSync(join(dir, "runs"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "transcripts", "wf_accept"), { recursive: true });
  writeFileSync(join(dir, "runs", "wf_accept.json"), JSON.stringify({
    runId: "wf_accept",
    taskId: "task_accept",
    workflowName: "acceptance-workflow",
    status: "completed",
    script: "",
    scriptPath: join(dir, "scripts", "acceptance.js"),
    transcriptDir: join(dir, "transcripts", "wf_accept"),
    defaultModel: "gpt-5.5",
    defaultEffort: "xhigh",
    defaultContextWindow: 1100000,
    phases: [{ title: "Plan" }, { title: "Execute" }],
    workflowProgress: [
      { type: "workflow_phase", index: 1, title: "Plan" },
      { type: "workflow_phase", index: 2, title: "Execute" },
      agent(1, "task-a", "prompt A", "ToolA", "activity A", "outcome A"),
      agent(2, "task-b", "prompt B", "ToolB", "activity B", "outcome B"),
    ],
    cacheResults: [],
    result: null,
    error: null,
    agentCount: 2,
    totalTokens: 2,
    totalToolCalls: 2,
    durationMs: 1000,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.001Z",
    completedAt: "2026-01-01T00:00:01.000Z",
  }, null, 2));
};

const agent = (
  index: number,
  label: string,
  promptPreview: string,
  lastToolName: string,
  lastToolSummary: string,
  resultPreview: string,
) => ({
  type: "workflow_agent",
  index,
  stepId: `step-${index}`,
  label,
  phaseIndex: 2,
  phaseTitle: "Execute",
  agentId: `agent-${index}`,
  model: "gpt-5.5",
  effort: "xhigh",
  contextWindow: 1100000,
  state: "done",
  promptPreview,
  lastToolName,
  lastToolSummary,
  resultPreview,
  updatedAt: 1,
  completedAt: 2,
  durationMs: 1,
  attempt: 1,
  tokens: 1,
  toolCalls: 1,
  retries: 0,
});
