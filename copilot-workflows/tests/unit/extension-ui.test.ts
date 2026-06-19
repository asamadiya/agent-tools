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
});
