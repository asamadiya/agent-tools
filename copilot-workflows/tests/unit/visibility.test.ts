import { describe, expect, it } from "vitest";
import { renderProgressTree } from "../../src/visibility.js";
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
          attempt: 1,
          tokens: 10,
          toolCalls: 1,
          retries: 0,
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
});
