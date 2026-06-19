import { describe, expect, it } from "vitest";
import {
  renderProgressTree,
  renderWorkflowDetail,
  renderWorkflowList,
  workflowListItems,
} from "../../src/visibility.js";
import type { WorkflowRun } from "../../src/types.js";

describe("workflow visibility", () => {
  it("renders phases and labelled agents", () => {
    const run = {
      runId: "wf_x",
      taskId: "w123",
      workflowName: "demo",
      status: "running",
      script: "",
      scriptPath: "/tmp/demo.js",
      transcriptDir: "/tmp/t",
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      phases: [{ title: "Read", detail: "read files" }],
      workflowProgress: [
        { type: "workflow_phase", index: 1, title: "Read", detail: "read files" },
        {
          type: "workflow_agent",
          index: 1,
          stepId: "step_1",
          label: "read:README",
          phaseIndex: 1,
          phaseTitle: "Read",
          agentId: "agent-a",
          model: "gpt-5.5",
          effort: "xhigh",
          contextWindow: 1_100_000,
          state: "running",
          updatedAt: 1,
          promptPreview: "Read README.md and summarize it",
          attempt: 1,
          tokens: 10,
          toolCalls: 1,
          retries: 0,
          lastToolName: "StructuredOutput",
          lastToolSummary: "reading README",
          resultPreview: "README summary",
        },
      ],
      result: null,
      error: null,
      agentCount: 1,
      totalTokens: 10,
      totalToolCalls: 1,
      durationMs: 100,
      createdAt: "x",
      startedAt: "x",
      updatedAt: "x",
      completedAt: null,
    } satisfies WorkflowRun;
    const tree = renderProgressTree(run);
    expect(tree).toContain("Read");
    expect(tree).toContain("read:README");
    expect(tree).toContain("running");
    expect(tree).toContain("gpt-5.5");
  });

  it("renders a Claude-like numbered workflow list", () => {
    const run = sampleRun({ status: "completed", agentCount: 2, totalTokens: 34_000 });
    const items = workflowListItems([run]);
    expect(items[0]).toMatchObject({
      workflowId: "WF1",
      runId: "wf_x",
      doneAgents: 1,
      totalAgents: 1,
      status: "completed",
    });

    const list = renderWorkflowList([run]);
    expect(list).toContain("WF1");
    expect(list).toContain("✔");
    expect(list).toContain("demo");
    expect(list).toContain("1/1 agents");
    expect(list).toContain("completed");
  });

  it("renders a split phase/task detail view with prompt, activity, and outcome", () => {
    const detail = renderWorkflowDetail(sampleRun({ status: "completed" }), { workflowId: "WF12" });

    expect(detail).toContain("WF12");
    expect(detail).toContain("╭ Phases");
    expect(detail).toContain("Read · 1 agent");
    expect(detail).toContain("❯ ✔ Read 1/1");
    expect(detail).toContain("✔ read:README");
    expect(detail).toContain("Prompt: Read README.md and summarize it");
    expect(detail).toContain("Activity: StructuredOutput — reading README");
    expect(detail).toContain("Outcome: README summary");
  });
});

const sampleRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  runId: "wf_x",
  taskId: "w123",
  workflowName: "demo",
  status: "running",
  script: "",
  scriptPath: "/tmp/demo.js",
  transcriptDir: "/tmp/t",
  defaultModel: "gpt-5.5",
  defaultEffort: "xhigh",
  defaultContextWindow: 1_100_000,
  phases: [{ title: "Read", detail: "read files" }],
  workflowProgress: [
    { type: "workflow_phase", index: 1, title: "Read", detail: "read files" },
    {
      type: "workflow_agent",
      index: 1,
      stepId: "step_1",
      label: "read:README",
      phaseIndex: 1,
      phaseTitle: "Read",
      agentId: "agent-a",
      model: "gpt-5.5",
      effort: "xhigh",
      contextWindow: 1_100_000,
      state: "done",
      updatedAt: 1,
      completedAt: 101,
      durationMs: 100,
      promptPreview: "Read README.md and summarize it",
      attempt: 1,
      tokens: 10,
      toolCalls: 1,
      retries: 0,
      lastToolName: "StructuredOutput",
      lastToolSummary: "reading README",
      resultPreview: "README summary",
    },
  ],
  result: null,
  error: null,
  agentCount: 1,
  totalTokens: 10,
  totalToolCalls: 1,
  durationMs: 100,
  createdAt: "x",
  startedAt: "x",
  updatedAt: "x",
  completedAt: null,
  cacheResults: [],
  ...overrides,
});
