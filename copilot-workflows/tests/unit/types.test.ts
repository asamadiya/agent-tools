import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_CONFIG,
  WorkflowProgressEntrySchema,
  WorkflowRunSchema,
} from "../../src/types.js";
import { newAgentId, newRunId, newTaskId, slugifyWorkflowName } from "../../src/ids.js";

describe("workflow shared types", () => {
  it("uses GPT-5.5 xhigh 1.1M as the default model config", () => {
    expect(DEFAULT_MODEL_CONFIG).toEqual({
      model: "gpt-5.5",
      effort: "xhigh",
      contextWindow: 1_100_000,
    });
  });

  it("validates a minimal completed run record", () => {
    const parsed = WorkflowRunSchema.parse({
      runId: "wf_abc123",
      taskId: "w123456789",
      workflowName: "demo",
      status: "completed",
      script: "export const meta = { name: 'demo', description: 'Demo' }",
      scriptPath: "/tmp/demo.js",
      transcriptDir: "/tmp/transcripts",
      args: { topic: "x" },
      resumeFromRunId: "wf_prior",
      budgetTokens: 10_000,
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      phases: [],
      workflowProgress: [],
      cacheResults: [],
      result: { ok: true },
      error: null,
      agentCount: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      durationMs: 10,
      createdAt: "2026-06-18T00:00:00.000Z",
      startedAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      completedAt: "2026-06-18T00:00:00.010Z",
    });
    expect(parsed.status).toBe("completed");
  });

  it("validates a running agent progress entry", () => {
    expect(
      WorkflowProgressEntrySchema.parse({
        type: "workflow_agent",
        index: 1,
        stepId: "step_1",
        label: "read:README",
        phaseIndex: 1,
        phaseTitle: "Read",
        agentId: "agent-a1",
        model: "gpt-5.5",
        effort: "xhigh",
        contextWindow: 1_100_000,
        state: "running",
        startedAt: 1000,
        updatedAt: 1001,
        promptPreview: "Read README.md",
        attempt: 1,
        tokens: 0,
        toolCalls: 0,
        retries: 0,
      }),
    ).toMatchObject({ label: "read:README", state: "running", promptPreview: "Read README.md" });
  });
});

describe("workflow ids", () => {
  it("creates recognizable ids", () => {
    expect(newRunId()).toMatch(/^wf_[a-f0-9]{8}-[a-f0-9]{3}$/);
    expect(newTaskId()).toMatch(/^w[a-z0-9]{8,}$/);
    expect(newAgentId()).toMatch(/^agent-[a-f0-9]{16}$/);
  });

  it("slugifies names for persisted script filenames", () => {
    expect(slugifyWorkflowName("Read README + package.json!")).toBe("read-readme-package-json");
    expect(slugifyWorkflowName("___")).toBe("workflow");
  });
});
