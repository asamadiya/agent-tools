import { describe, expect, it } from "vitest";
import {
  StubAgentBackend,
  runAgentWithSchemaRetry,
  validateJsonSchemaResult,
} from "../../src/agent-runtime.js";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } },
};

describe("agent runtime", () => {
  it("returns text when no schema is provided", async () => {
    const backend = new StubAgentBackend([{ text: "plain response", tokens: 12, toolCalls: 1 }]);
    const out = await runAgentWithSchemaRetry(
      {
        prompt: "say hi",
        stepId: "step_1",
        agentId: "agent-a",
        model: "gpt-5.5",
        effort: "xhigh",
        contextWindow: 1_100_000,
      },
      backend,
      { maxRetries: 1 },
    );
    expect(out.result).toBe("plain response");
    expect(out.tokens).toBe(12);
  });

  it("validates structured output against a small JSON schema", () => {
    expect(validateJsonSchemaResult({ summary: "ok" }, schema)).toEqual({ summary: "ok" });
    expect(() => validateJsonSchemaResult({ summary: 1 }, schema)).toThrow(/summary/);
    expect(() => validateJsonSchemaResult({ summary: "ok", extra: true }, schema)).toThrow(
      /additional/i,
    );
  });

  it("retries malformed structured output and succeeds", async () => {
    const backend = new StubAgentBackend([
      { text: "not json", tokens: 3, toolCalls: 1 },
      { text: JSON.stringify({ summary: "ok" }), tokens: 4, toolCalls: 1 },
    ]);
    const out = await runAgentWithSchemaRetry(
      {
        prompt: "summarize",
        stepId: "step_1",
        agentId: "agent-a",
        model: "gpt-5.5",
        effort: "xhigh",
        contextWindow: 1_100_000,
        schema,
      },
      backend,
      { maxRetries: 2 },
    );
    expect(out.result).toEqual({ summary: "ok" });
    expect(out.retries).toBe(1);
  });

  it("fails cleanly when schema retries are exhausted", async () => {
    const backend = new StubAgentBackend([
      { text: JSON.stringify({ summary: 1 }), tokens: 3, toolCalls: 1 },
      { text: JSON.stringify({ nope: "x" }), tokens: 4, toolCalls: 1 },
    ]);
    await expect(
      runAgentWithSchemaRetry(
        {
          prompt: "summarize",
          stepId: "step_1",
          agentId: "agent-a",
          model: "gpt-5.5",
          effort: "xhigh",
          contextWindow: 1_100_000,
          schema,
        },
        backend,
        { maxRetries: 1 },
      ),
    ).rejects.toThrow(/schema validation failed/i);
  });
});
