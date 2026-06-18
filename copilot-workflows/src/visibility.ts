import type { WorkflowRun } from "./types.js";

export const renderProgressTree = (run: WorkflowRun): string => {
  const lines = [`${run.workflowName} ${run.status} ${run.agentCount} agents ${run.totalTokens} tokens`];
  for (const entry of run.workflowProgress) {
    if (entry.type === "workflow_phase") {
      lines.push(`▸ ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""}`);
    } else if (entry.type === "workflow_log") {
      lines.push(`  • ${entry.message}`);
    } else {
      lines.push(
        `  ${entry.state.padEnd(9)} ${entry.label} ${entry.model}/${entry.effort} tokens=${entry.tokens} tools=${entry.toolCalls}`,
      );
    }
  }
  return lines.join("\n");
};
