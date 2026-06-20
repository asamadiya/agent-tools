import { describe, expect, it } from "vitest";
import {
  CopilotPrintBackend,
  parseCopilotJsonOutput,
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

describe("CopilotPrintBackend option handling", () => {
  const baseInput = {
    prompt: "do it",
    stepId: "step_1",
    agentId: "agent-a",
    model: "gpt-5.5",
    effort: "xhigh",
    contextWindow: 1_100_000,
  };

  it("hard-fails systemPrompt instead of silently dropping it", async () => {
    const backend = new CopilotPrintBackend();
    await expect(
      backend.run({ ...baseInput, systemPrompt: "be terse" }),
    ).rejects.toThrow(/systemPrompt/i);
  });

  it("hard-fails isolation:'worktree' instead of silently dropping it", async () => {
    const backend = new CopilotPrintBackend();
    await expect(
      backend.run({ ...baseInput, isolation: "worktree" }),
    ).rejects.toThrow(/worktree|isolation/i);
  });

  it("builds CLI args forwarding permissions and allowed/denied tools", () => {
    const backend = new CopilotPrintBackend();
    const args = backend.buildArgs({
      ...baseInput,
      permissions: "plan",
      allowedTools: ["read", "grep"],
      deniedTools: ["write"],
    });
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("plan");
    expect(args).toContain("--allow-tool=read");
    expect(args).toContain("--allow-tool=grep");
    expect(args).toContain("--deny-tool=write");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toBe("do it");
    expect(args).not.toContain("-s");
  });

  it("maps permissions to copilot-supported --mode values", () => {
    const backend = new CopilotPrintBackend();
    const autoArgs = backend.buildArgs({ ...baseInput, permissions: "auto" });
    expect(autoArgs).toContain("--mode");
    expect(autoArgs[autoArgs.indexOf("--mode") + 1]).toBe("autopilot");

    const planArgs = backend.buildArgs({ ...baseInput, permissions: "plan" });
    expect(planArgs[planArgs.indexOf("--mode") + 1]).toBe("plan");
  });

  it("omits --mode for 'default' permissions and when unset", () => {
    const backend = new CopilotPrintBackend();
    expect(backend.buildArgs({ ...baseInput, permissions: "default" })).not.toContain("--mode");
    expect(backend.buildArgs(baseInput)).not.toContain("--mode");
  });

  it("hard-fails unsupported permission modes instead of forwarding invalid --mode", () => {
    const backend = new CopilotPrintBackend();
    expect(() => backend.buildArgs({ ...baseInput, permissions: "dontAsk" })).toThrow(
      /dontAsk/,
    );
    expect(() => backend.buildArgs({ ...baseInput, permissions: "bypassPermissions" })).toThrow(
      /bypassPermissions/,
    );
  });
});

describe("Copilot JSONL output parsing", () => {
  it("extracts final text, tokens, tool call count, and recent tool activity", () => {
    const jsonl = [
      {
        type: "assistant.message",
        data: {
          content: "",
          outputTokens: 19,
          toolRequests: [
            {
              toolCallId: "call_1",
              name: "bash",
              arguments: { command: "pwd", description: "Print working directory" },
              intentionSummary: "Print working directory",
            },
          ],
        },
      },
      {
        type: "tool.execution_start",
        data: { toolCallId: "call_1", toolName: "bash", arguments: { command: "pwd" } },
      },
      {
        type: "assistant.message",
        data: { content: "done", outputTokens: 7, toolRequests: [] },
      },
      { type: "result", exitCode: 0, usage: { sessionDurationMs: 1000 } },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    expect(parseCopilotJsonOutput(jsonl)).toEqual({
      text: "done",
      tokens: 26,
      toolCalls: 1,
      lastToolName: "bash",
      lastToolSummary: "pwd",
      recentToolCalls: [{ name: "bash", summary: "pwd" }],
    });
  });

  it("falls back to assembled message deltas when no completed assistant message is present", () => {
    const jsonl = [
      { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "hel" } },
      { type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "lo" } },
      { type: "assistant.message", data: { content: "", outputTokens: 3, toolRequests: [] } },
      { type: "result", exitCode: 0 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    expect(parseCopilotJsonOutput(jsonl).text).toBe("hello");
  });

  it("ignores non-JSON diagnostics once a valid JSONL event is present", () => {
    const jsonl = [
      "warning: noisy extension wrote to stdout",
      JSON.stringify({ type: "assistant.message", data: { content: "ok", outputTokens: 5 } }),
      JSON.stringify({ type: "result", exitCode: 0 }),
    ].join("\n");

    expect(parseCopilotJsonOutput(jsonl)).toMatchObject({ text: "ok", tokens: 5 });
  });

  it("does not count report_intent as user-visible tool activity", () => {
    const jsonl = [
      JSON.stringify({
        type: "tool.execution_start",
        data: {
          toolCallId: "meta_1",
          toolName: "report_intent",
          arguments: { intent: "Running command" },
        },
      }),
      JSON.stringify({
        type: "tool.execution_start",
        data: { toolCallId: "call_1", toolName: "bash", arguments: { command: "pwd" } },
      }),
      JSON.stringify({ type: "assistant.message", data: { content: "ok", outputTokens: 5 } }),
    ].join("\n");

    expect(parseCopilotJsonOutput(jsonl)).toMatchObject({
      toolCalls: 1,
      recentToolCalls: [{ name: "bash", summary: "pwd" }],
    });
  });
});
