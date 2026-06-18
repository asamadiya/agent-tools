import { describe, expect, it } from "vitest";
import { agentCacheKey } from "../../src/cache.js";

describe("workflow cache keys", () => {
  it("is stable for same prompt, opts, and args", () => {
    const a = agentCacheKey("read README", { label: "read", model: "gpt-5.5" }, { topic: "x" });
    const b = agentCacheKey("read README", { model: "gpt-5.5", label: "read" }, { topic: "x" });
    expect(a).toBe(b);
  });

  it("changes when prompt, schema, model, effort, label, phase, or args change", () => {
    const base = agentCacheKey("p", { label: "l", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 1 });
    expect(agentCacheKey("p2", { label: "l", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l2", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "B", model: "gpt-5.5", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "A", model: "other", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "A", model: "gpt-5.5", effort: "high" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 2 })).not.toBe(base);
  });

  it("changes when effective model, effort, or contextWindow differs", () => {
    const base = agentCacheKey("p", { label: "l" }, {}, { model: "gpt-5.5", effort: "xhigh", contextWindow: 1_100_000 });
    expect(agentCacheKey("p", { label: "l" }, {}, { model: "claude-opus-4.8", effort: "xhigh", contextWindow: 1_100_000 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l" }, {}, { model: "gpt-5.5", effort: "high", contextWindow: 1_100_000 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l" }, {}, { model: "gpt-5.5", effort: "xhigh", contextWindow: 200_000 })).not.toBe(base);
    // Same effective values → same key
    expect(agentCacheKey("p", { label: "l" }, {}, { model: "gpt-5.5", effort: "xhigh", contextWindow: 1_100_000 })).toBe(base);
  });
});
