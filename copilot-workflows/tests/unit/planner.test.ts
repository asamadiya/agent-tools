import { describe, expect, it } from "vitest";
import { extractWorkflowMeta } from "../../src/script.js";
import { generateWorkflowScriptFromGoal } from "../../src/planner.js";

describe("workflow goal planner", () => {
  it("generates deterministic JS for an inline workflow goal", () => {
    const script = generateWorkflowScriptFromGoal("workflow: compare README and package metadata");
    expect(script).toContain("export const meta");
    expect(script).toContain("agent(");
    expect(script).toContain("parallel(");
    expect(script).not.toContain("Date.now");
    const meta = extractWorkflowMeta(script);
    expect(meta.name).toBe("compare-readme-and-package-metadata");
    expect(meta.description).toContain("compare README and package metadata");
  });
});
