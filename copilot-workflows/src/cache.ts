import { createHash } from "node:crypto";
import type { AgentStepOptions } from "./types.js";

const stable = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, stable(val)]),
    );
  }
  return v;
};

export const agentCacheKey = (
  prompt: string,
  opts: Partial<AgentStepOptions>,
  args: unknown,
): string => {
  const payload = JSON.stringify(stable({ prompt, opts, args }));
  return `v1:${createHash("sha256").update(payload).digest("hex")}`;
};
