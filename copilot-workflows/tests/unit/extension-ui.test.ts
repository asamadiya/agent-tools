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

  it("targets the pane for the current Copilot session instead of a stale global TMUX_PANE", () => {
    const src = extensionSource();
    expect(src).toContain("resolveCopilotPane");
    expect(src).toContain("COPILOT_LOADER_PID");
    expect(src).toContain("SESSION_ID");
    expect(src).toContain("execFileText(\"tmux\"");
    expect(src).toContain("\"list-panes\"");
    expect(src).toContain("\"-a\"");
  });

  it("requests Copilot native canvas rendering before falling back to tmux", () => {
    const src = extensionSource();
    expect(src).toContain("requestCanvasRenderer: true");
    expect(src).toContain("session.capabilities.ui?.canvases");
    expect(src.slice(src.indexOf("session = await joinSession({"))).toContain("requestCanvasRenderer: true");
  });
});
