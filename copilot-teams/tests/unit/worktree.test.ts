import { describe, expect, it } from "vitest";
import { generateBranchName } from "../../src/worktree.js";

describe("generateBranchName", () => {
  const UUID = "abcdef01-2345-6789-abcd-ef0123456789";

  it("uses safe-charset prefix and 8-char short id", () => {
    const b = generateBranchName("agent-foo", UUID);
    expect(b).toBe("copilot-teams/agent-foo-abcdef01");
  });

  it("collapses unsafe chars in prefix to '-'", () => {
    expect(generateBranchName("hi there!@#", UUID)).toBe(
      "copilot-teams/hi-there-abcdef01",
    );
  });

  it("falls back to 'agent' when prefix is empty after sanitization", () => {
    expect(generateBranchName("***", UUID)).toBe("copilot-teams/agent-abcdef01");
    expect(generateBranchName("   ", UUID)).toBe("copilot-teams/agent-abcdef01");
  });

  it("trims leading/trailing dashes from sanitized prefix", () => {
    expect(generateBranchName("---x---", UUID)).toBe("copilot-teams/x-abcdef01");
  });

  it("strips uuid hyphens for the short id", () => {
    const out = generateBranchName("p", UUID);
    expect(out.endsWith("-abcdef01")).toBe(true);
  });
});
