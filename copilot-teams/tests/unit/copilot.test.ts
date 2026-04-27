import { describe, expect, it } from "vitest";
import { buildArgs, isUuid, type CopilotInvocation } from "../../src/copilot.js";

const UUID = "11111111-2222-3333-4444-555555555555";

describe("isUuid", () => {
  it.each([
    [UUID, true],
    ["11111111-2222-3333-4444-555555555555".toUpperCase(), true],
    ["not-a-uuid", false],
    ["", false],
    ["11111111-2222-3333-4444", false],
    ["11111111-2222-3333-4444-555555555555-extra", false],
  ])("isUuid(%s) === %s", (s, expected) => {
    expect(isUuid(s)).toBe(expected);
  });
});

describe("buildArgs", () => {
  const base = (over: Partial<CopilotInvocation> = {}): CopilotInvocation => ({
    uuid: UUID,
    prompt: "hello world",
    background: false,
    ...over,
  });

  it("rejects bad uuid", () => {
    expect(() => buildArgs(base({ uuid: "bad" }))).toThrow(/bad uuid/);
  });

  it("rejects empty prompt in foreground mode", () => {
    expect(() => buildArgs(base({ prompt: "" }))).toThrow(/non-empty prompt/);
  });

  it("permits omitted prompt in background mode (typed via send-keys later)", () => {
    const args = buildArgs({ uuid: UUID, background: true });
    expect(args).toContain("--allow-all-tools");
    expect(args).not.toContain("-p");
    expect(args).not.toContain("-i");
  });

  it("foreground emits -p, -s, --allow-all-tools", () => {
    const args = buildArgs(base());
    expect(args).toContain("-p");
    expect(args).toContain("hello world");
    expect(args).toContain("-s");
    expect(args).toContain("--allow-all-tools");
    expect(args).not.toContain("-i");
  });

  it("background emits no -p, no -i, no prompt (REPL gets prompt via send-keys)", () => {
    const args = buildArgs(base({ background: true }));
    expect(args).toContain("--allow-all-tools");
    expect(args).not.toContain("-p");
    expect(args).not.toContain("-i");
    expect(args).not.toContain("-s");
    expect(args).not.toContain("hello world");
  });

  it("allowedTools emits repeated --allow-tool= and skips --allow-all-tools", () => {
    const args = buildArgs(base({ allowedTools: ["shell(git:*)", "write"] }));
    expect(args).toContain("--allow-tool=shell(git:*)");
    expect(args).toContain("--allow-tool=write");
    expect(args).not.toContain("--allow-all-tools");
  });

  it("deniedTools emits --deny-tool= and keeps --allow-all-tools as baseline", () => {
    const args = buildArgs(base({ deniedTools: ["shell(rm:*)"] }));
    expect(args).toContain("--allow-all-tools");
    expect(args).toContain("--deny-tool=shell(rm:*)");
  });

  it("addDirs emits repeated --add-dir", () => {
    const args = buildArgs(base({ addDirs: ["/a", "/b"] }));
    expect(args).toContain("--add-dir");
    const idx = args.indexOf("--add-dir");
    expect(args[idx + 1]).toBe("/a");
  });

  it("threads --resume=<uuid> first", () => {
    const args = buildArgs(base());
    expect(args[0]).toBe(`--resume=${UUID}`);
  });

  it("never emits --name (mutually exclusive with --resume in copilot CLI)", () => {
    const args = buildArgs(base({ name: "alice" }));
    expect(args.some((a) => a.startsWith("--name"))).toBe(false);
  });

  it("emits --agent <type> when subagentType set", () => {
    const args = buildArgs(base({ subagentType: "researcher" }));
    const i = args.indexOf("--agent");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("researcher");
  });

  it("emits --model <m> when model set", () => {
    const args = buildArgs(base({ model: "claude-opus-4.7" }));
    const i = args.indexOf("--model");
    expect(args[i + 1]).toBe("claude-opus-4.7");
  });

  it("emits --mode <m> when mode set", () => {
    const args = buildArgs(base({ mode: "yolo" }));
    const i = args.indexOf("--mode");
    expect(args[i + 1]).toBe("yolo");
  });

  // Combinatorial coverage: name × subagentType × model × mode × bg
  const flags = [false, true];
  const cases: Array<[boolean, boolean, boolean, boolean, boolean]> = [];
  for (const n of flags)
    for (const a of flags)
      for (const m of flags)
        for (const md of flags)
          for (const bg of flags) cases.push([n, a, m, md, bg]);

  it.each(cases)(
    "combinatorial: name=%s agent=%s model=%s mode=%s bg=%s produces well-formed argv",
    (name, agent, model, mode, bg) => {
      const inv = base({
        background: bg,
        ...(name ? { name: "n" } : {}),
        ...(agent ? { subagentType: "researcher" } : {}),
        ...(model ? { model: "claude-opus-4.7" } : {}),
        ...(mode ? { mode: "yolo" } : {}),
      });
      const args = buildArgs(inv);
      expect(args[0]).toBe(`--resume=${UUID}`);
      expect(args).toContain("--allow-all-tools");
      // Foreground takes the prompt on argv (-p); background takes none.
      if (bg) {
        expect(args).not.toContain("-p");
        expect(args).not.toContain("hello world");
      } else {
        expect(args).toContain("-p");
        expect(args).toContain("hello world");
      }
      expect(args).not.toContain("-i");
      // --name is dropped unconditionally (mutually exclusive with --resume).
      expect(args.some((a) => a.startsWith("--name="))).toBe(false);
      void name;
      expect(args.includes("--agent")).toBe(agent);
      expect(args.includes("--model")).toBe(model);
      expect(args.includes("--mode")).toBe(mode);
      expect(args.includes("-s")).toBe(!bg); // foreground only
    },
  );
});
