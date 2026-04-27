import { describe, expect, it } from "vitest";
import {
  parseListWindows,
  findSentinels,
  lastSentinel,
  getTmuxContext,
  defaultTeamSession,
} from "../../src/tmux.js";

describe("parseListWindows", () => {
  it("parses well-formed list-windows -F output", () => {
    const stdout = "@1 cop:alice 1234\n@2 cop:bob 5678\n";
    expect(parseListWindows(stdout)).toEqual([
      { windowId: "@1", windowName: "cop:alice", panePid: 1234 },
      { windowId: "@2", windowName: "cop:bob", panePid: 5678 },
    ]);
  });

  it("ignores blank lines", () => {
    expect(parseListWindows("\n\n@1 x 1\n\n").length).toBe(1);
  });

  it("ignores malformed rows", () => {
    expect(parseListWindows("garbage\n@1 only-two\n@2 ok 99\n")).toEqual([
      { windowId: "@2", windowName: "ok", panePid: 99 },
    ]);
  });

  it("ignores rows with non-numeric pid", () => {
    expect(parseListWindows("@1 x notanumber\n").length).toBe(0);
  });

  it("returns empty for empty input", () => {
    expect(parseListWindows("")).toEqual([]);
  });
});

describe("findSentinels / lastSentinel", () => {
  it("finds zero in clean text", () => {
    expect(findSentinels("nothing here")).toEqual([]);
    expect(lastSentinel("nothing here")).toBeNull();
  });

  it("finds one sentinel", () => {
    const text = "blah <<<COPILOT_TURN_DONE:t1>>> more";
    const hits = findSentinels(text);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.turn).toBe("t1");
  });

  it("finds multiple sentinels", () => {
    const text = "<<<COPILOT_TURN_DONE:a>>> mid <<<COPILOT_TURN_DONE:b>>> end";
    const hits = findSentinels(text);
    expect(hits.map((h) => h.turn)).toEqual(["a", "b"]);
    expect(lastSentinel(text)?.turn).toBe("b");
  });

  it("handles partial reads where only the prefix is present", () => {
    expect(findSentinels("<<<COPILOT_TURN_DONE:partial")).toEqual([]);
  });

  it("handles uuid-style turn ids", () => {
    const t = "<<<COPILOT_TURN_DONE:11111111-2222-3333-4444-555555555555>>>";
    expect(lastSentinel(t)?.turn).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });
});

describe("getTmuxContext", () => {
  it("returns inTmux=false when TMUX unset", () => {
    expect(getTmuxContext({})).toEqual({ inTmux: false, pane: null });
  });

  it("returns pane when TMUX_PANE present", () => {
    expect(getTmuxContext({ TMUX: "/tmp/t,1,2", TMUX_PANE: "%5" })).toEqual({
      inTmux: true,
      pane: "%5",
    });
  });
});

describe("defaultTeamSession", () => {
  it("includes pid", () => {
    expect(defaultTeamSession(42)).toBe("copilot-team-42");
  });
});
