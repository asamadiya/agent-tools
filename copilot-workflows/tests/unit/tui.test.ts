import { describe, expect, it } from "vitest";
import {
  createWorkflowUiState,
  handleWorkflowUiKey,
  renderWorkflowUi,
} from "../../src/tui.js";
import type { WorkflowRun } from "../../src/types.js";

describe("workflow TUI state", () => {
  it("navigates workflow list and opens selected detail", () => {
    let state = createWorkflowUiState(sampleRuns());
    expect(renderWorkflowUi(sampleRuns(), state)).toContain("WF1");

    state = handleWorkflowUiKey(state, sampleRuns(), "down");
    expect(state.selectedRunIndex).toBe(1);
    expect(renderWorkflowUi(sampleRuns(), state)).toContain("❯ WF2");

    state = handleWorkflowUiKey(state, sampleRuns(), "enter");
    expect(state.view).toBe("workflow");
    expect(renderWorkflowUi(sampleRuns(), state)).toContain("WF2 second");
    expect(renderWorkflowUi(sampleRuns(), state)).toContain("Phase outcome");

    state = handleWorkflowUiKey(state, sampleRuns(), "escape");
    expect(state.view).toBe("list");

    state = handleWorkflowUiKey(state, sampleRuns(), "q");
    expect(state.quit).toBe(true);
  });

  it("drills in with right arrow, selects phases/tasks with arrows, and scrolls task detail with vim keys", () => {
    const runs = sampleRunsWithMultipleTasks();
    let state = createWorkflowUiState(runs);

    state = handleWorkflowUiKey(state, runs, "down");
    expect(state.selectedRunIndex).toBe(1);

    state = handleWorkflowUiKey(state, runs, "right");
    expect(state.view).toBe("workflow");

    state = handleWorkflowUiKey(state, runs, "down");
    expect(state.selectedPhaseIndex).toBe(1);
    expect(renderWorkflowUi(runs, state)).toContain("Phase outcome");
    expect(renderWorkflowUi(runs, state)).toContain("outcome second-a");
    expect(renderWorkflowUi(runs, state)).toContain("outcome second-b");

    state = handleWorkflowUiKey(state, runs, "right");
    expect(state.view).toBe("tasks");

    state = handleWorkflowUiKey(state, runs, "down");
    expect(state.selectedAgentIndex).toBe(1);
    expect(renderWorkflowUi(runs, state)).toContain("❯ ✔ read:second-b");

    state = handleWorkflowUiKey(state, runs, "right");
    expect(state.view).toBe("agent");
    expect(renderWorkflowUi(runs, state)).toContain("Agent details");
    expect(renderWorkflowUi(runs, state)).toContain("Prompt: prompt second-b");
    expect(renderWorkflowUi(runs, state)).toContain("Outcome: outcome second-b");

    state = handleWorkflowUiKey(state, runs, "j");
    expect(state.detailScroll).toBe(1);
    state = handleWorkflowUiKey(state, runs, "k");
    expect(state.detailScroll).toBe(0);

    state = handleWorkflowUiKey(state, runs, "left");
    expect(state.view).toBe("tasks");
    state = handleWorkflowUiKey(state, runs, "left");
    expect(state.view).toBe("workflow");
    state = handleWorkflowUiKey(state, runs, "left");
    expect(state.view).toBe("list");
  });
});

const run = (runId: string, name: string, label: string): WorkflowRun => ({
  runId,
  taskId: `task-${runId}`,
  workflowName: name,
  status: "completed",
  script: "",
  scriptPath: "/tmp/script.js",
  transcriptDir: "/tmp/transcripts",
  defaultModel: "gpt-5.5",
  defaultEffort: "xhigh",
  defaultContextWindow: 1_100_000,
  phases: [{ title: "Read" }],
  workflowProgress: [
    { type: "workflow_phase", index: 1, title: "Read" },
    {
      type: "workflow_agent",
      index: 1,
      stepId: `step-${runId}`,
      label,
      phaseTitle: "Read",
      phaseIndex: 1,
      agentId: `agent-${runId}`,
      model: "gpt-5.5",
      effort: "xhigh",
      contextWindow: 1_100_000,
      state: "done",
      promptPreview: `prompt ${name}`,
      resultPreview: `outcome ${name}`,
      updatedAt: 1,
      attempt: 1,
      tokens: 1,
      toolCalls: 1,
      retries: 0,
    },
  ],
  cacheResults: [],
  result: null,
  error: null,
  agentCount: 1,
  totalTokens: 1,
  totalToolCalls: 1,
  durationMs: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:00.001Z",
});

const sampleRuns = (): WorkflowRun[] => [
  run("wf_one", "first", "read:first"),
  run("wf_two", "second", "read:second"),
];

const sampleRunsWithMultipleTasks = (): WorkflowRun[] => {
  const base = run("wf_two", "second", "read:second-a");
  base.phases = [{ title: "Read" }, { title: "Write" }];
  base.workflowProgress = [
    { type: "workflow_phase", index: 1, title: "Read" },
    { type: "workflow_phase", index: 2, title: "Write" },
    {
      type: "workflow_agent",
      index: 1,
      stepId: "step-a",
      label: "read:second-a",
      phaseTitle: "Write",
      phaseIndex: 2,
      agentId: "agent-a",
      model: "gpt-5.5",
      effort: "xhigh",
      contextWindow: 1_100_000,
      state: "done",
      promptPreview: "prompt second-a",
      resultPreview: "outcome second-a",
      updatedAt: 1,
      attempt: 1,
      tokens: 1,
      toolCalls: 1,
      retries: 0,
    },
    {
      type: "workflow_agent",
      index: 2,
      stepId: "step-b",
      label: "read:second-b",
      phaseTitle: "Write",
      phaseIndex: 2,
      agentId: "agent-b",
      model: "gpt-5.5",
      effort: "xhigh",
      contextWindow: 1_100_000,
      state: "done",
      promptPreview: "prompt second-b",
      resultPreview: "outcome second-b",
      updatedAt: 1,
      attempt: 1,
      tokens: 1,
      toolCalls: 1,
      retries: 0,
    },
  ];
  return [run("wf_one", "first", "read:first"), base];
};
