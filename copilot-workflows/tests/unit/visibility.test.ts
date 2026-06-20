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

  it("renders Claude-like live agent details for running tasks", () => {
    const run = sampleRun({ status: "running" });
    const agent = run.workflowProgress.find((p) => p.type === "workflow_agent");
    if (agent?.type !== "workflow_agent") throw new Error("not an agent entry");
    agent.state = "running";
    agent.model = "claude-opus-4.8";
    agent.contextWindow = 1_000_000;
    agent.tokens = 175_500;
    agent.toolCalls = 83;
    agent.updatedAt = Date.now() - 116_000;
    agent.promptPreview = ["line 1", "line 2", "line 3", "line 4"].join("\n");
    agent.recentToolCalls = [
      { name: "Read", summary: "README.md" },
      { name: "Bash", summary: "npm test" },
      { name: "StructuredOutput", summary: "agent result" },
    ];

    const detail = renderWorkflowDetail(run, { workflowId: "WF1" });

    expect(detail).toContain("● Running · claude-opus-4.8 (1M context)");
    expect(detail).toContain("175.5k tok · 83 tool calls · idle 1m 56s");
    expect(detail).toContain("Prompt · 4 lines · expand");
    expect(detail).toContain("line 1");
    expect(detail).toContain("… 2 more lines");
    expect(detail).toContain("Activity · last 3 of 83 tool calls");
    expect(detail).toContain("Bash(npm test)");
    expect(detail).toContain("Outcome");
    expect(detail).toContain("Still running…");
  });

  it("renders Claude-like finished agent details with task id and dependencies", () => {
    const run = sampleRun({ status: "completed" });
    const agent = run.workflowProgress.find((p) => p.type === "workflow_agent");
    if (agent?.type !== "workflow_agent") throw new Error("not an agent entry");
    agent.dagTaskId = "summary";
    agent.dependsOn = ["read", "analyze"];
    agent.recentToolCalls = [
      { name: "Write", summary: "/tmp/report.md" },
      { name: "Bash", summary: "ls -la /tmp" },
      { name: "StructuredOutput", summary: "summary" },
    ];
    agent.resultPreview = "Finished the requested workflow.\n\n## Summary\nDetailed outcome.";

    const detail = renderWorkflowDetail(run, { workflowId: "WF1" });

    expect(detail).toContain("✔ Completed · gpt-5.5 (1.1M context)");
    expect(detail).toContain("Task id: summary");
    expect(detail).toContain("Depends on: read, analyze");
    expect(detail).toContain("Activity · last 3 of 1 tool call");
    expect(detail).toContain("Write(/tmp/report.md)");
    expect(detail).toContain("Outcome");
    expect(detail).toContain("Finished the requested workflow.");
    expect(detail).toContain("## Summary");
  });

  it("renders DAG dependency metadata in task details", () => {
    const run = sampleRun();
    const agent = run.workflowProgress.find((p) => p.type === "workflow_agent");
    if (agent?.type !== "workflow_agent") throw new Error("not an agent entry");
    agent.dagTaskId = "summarize";
    agent.dependsOn = ["plan", "build"];

    const detail = renderWorkflowDetail(run, { workflowId: "WF1" });

    expect(detail).toContain("Task id: summarize");
    expect(detail).toContain("Depends on: plan, build");
  });

  it("aligns split table borders with body columns", () => {
    const lines = renderWorkflowDetail(sampleRun(), { workflowId: "WF1" }).split("\n");
    const top = lines.find((line) => line.startsWith("╭ "))!;
    const body = lines.find((line) => line.startsWith("│ "))!;
    const bottom = lines.find((line) => line.startsWith("╰"))!;

    expect(top.indexOf("┬")).toBe(body.indexOf("│", 1));
    expect(bottom.indexOf("┴")).toBe(body.indexOf("│", 1));
    expect(top.indexOf("╮")).toBe(body.lastIndexOf("│"));
    expect(bottom.indexOf("╯")).toBe(body.lastIndexOf("│"));
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
