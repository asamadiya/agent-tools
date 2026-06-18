import { randomBytes } from "node:crypto";

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

export const newRunId = (): string => `wf_${hex(4)}-${hex(2).slice(0, 3)}`;

export const newTaskId = (): string => `w${hex(6)}`;

export const newAgentId = (): string => `agent-${hex(8)}`;

export const slugifyWorkflowName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "workflow";
};
