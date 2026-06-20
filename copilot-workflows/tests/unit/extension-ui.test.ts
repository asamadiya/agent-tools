import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extensionSource = () =>
  readFileSync(resolve(process.cwd(), "..", ".github", "extensions", "workflow-ui", "extension.mjs"), "utf8");

describe("workflow extension browser UI", () => {
  it("intercepts navigation keys instead of letting the browser scroll the popup", () => {
    const src = extensionSource();
    expect(src).toContain("e.preventDefault()");
    expect(src).toContain("e.stopPropagation()");
  });

  it("renders phase-level outcomes before drilling into task details", () => {
    const src = extensionSource();
    expect(src).toContain("Phase outcome");
    expect(src).toContain("phaseSummary");
  });

  it("renders task dependency metadata in details", () => {
    const src = extensionSource();
    expect(src).toContain("Task id");
    expect(src).toContain("selected?.dagTaskId");
    expect(src).toContain("Depends on");
    expect(src).toContain("selected?.dependsOn");
  });

  it("does not use tmux fallback surfaces that can leak into another pane", () => {
    const src = extensionSource();
    expect(src).not.toContain("display-popup");
    expect(src).not.toContain("resolveCopilotPane");
    expect(src).not.toContain("TMUX_PANE");
  });

  it("requests Copilot native canvas rendering without falling back to a global tmux popup", () => {
    const src = extensionSource();
    expect(src).toContain("requestCanvasRenderer: true");
    expect(src).toContain("session.capabilities.ui?.canvases");
    expect(src.slice(src.indexOf("session = await joinSession({"))).toContain("requestCanvasRenderer: true");
    expect(src).not.toContain("display-popup");
  });
});
