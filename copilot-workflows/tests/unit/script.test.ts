import { describe, expect, it } from "vitest";
import {
  extractWorkflowMeta,
  inspectWorkflowScript,
  stripMetaExport,
  validateDeterministicScript,
} from "../../src/script.js";

const VALID = `
export const meta = {
  name: 'readme-check',
  description: 'Read README and summarize',
  phases: [{ title: 'Read', detail: 'read files' }],
}

phase('Read')
return await agent('read README', { label: 'read:README' })
`;

describe("workflow script parser", () => {
  it("extracts pure literal meta and strips the export", () => {
    expect(extractWorkflowMeta(VALID)).toEqual({
      name: "readme-check",
      description: "Read README and summarize",
      phases: [{ title: "Read", detail: "read files" }],
    });
    expect(stripMetaExport(VALID)).not.toContain("export const meta");
  });

  it("rejects non-literal meta before runtime", () => {
    expect(() =>
      extractWorkflowMeta("const name = 'x'; export const meta = { name, description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { ...x, name: 'x', description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { name: makeName(), description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { name: `x`, description: 'bad' }"),
    ).toThrow(/pure literal/i);
  });

  it("rejects deterministic hazards", () => {
    expect(() => validateDeterministicScript(`${VALID}\nDate.now()`)).toThrow(/Date\.now/);
    expect(() => validateDeterministicScript(`${VALID}\nMath.random()`)).toThrow(/Math\.random/);
    expect(() => validateDeterministicScript(`${VALID}\nnew Date()`)).toThrow(/new Date/);
  });

  it("returns inspection errors without throwing", () => {
    const out = inspectWorkflowScript("export const meta = { name: makeName(), description: 'bad' }");
    expect(out.valid).toBe(false);
    expect(out.errors.join("\n")).toMatch(/pure literal/i);
  });
});
