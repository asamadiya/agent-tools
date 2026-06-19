import { listRuns, type StateOptions } from "./state.js";
import type { WorkflowRun } from "./types.js";
import {
  renderWorkflowDetail,
  renderWorkflowList,
  workflowIdForRun,
} from "./visibility.js";

export interface WorkflowUiState {
  view: "list" | "detail";
  selectedRunIndex: number;
  quit: boolean;
}

export type WorkflowUiKey = "up" | "down" | "enter" | "escape" | "q" | "refresh";

export const createWorkflowUiState = (runs: WorkflowRun[]): WorkflowUiState => ({
  view: "list",
  selectedRunIndex: runs.length > 0 ? 0 : -1,
  quit: false,
});

const clampRunIndex = (idx: number, runs: WorkflowRun[]): number => {
  if (runs.length === 0) return -1;
  return Math.max(0, Math.min(idx, runs.length - 1));
};

export const handleWorkflowUiKey = (
  state: WorkflowUiState,
  runs: WorkflowRun[],
  key: WorkflowUiKey,
): WorkflowUiState => {
  if (key === "q") return { ...state, quit: true };
  if (key === "refresh") return { ...state, selectedRunIndex: clampRunIndex(state.selectedRunIndex, runs) };
  if (key === "escape") return { ...state, view: "list" };
  if (key === "enter" && state.selectedRunIndex >= 0) return { ...state, view: "detail" };
  if (key === "up") return { ...state, selectedRunIndex: clampRunIndex(state.selectedRunIndex - 1, runs) };
  if (key === "down") return { ...state, selectedRunIndex: clampRunIndex(state.selectedRunIndex + 1, runs) };
  return state;
};

export const renderWorkflowUi = (runs: WorkflowRun[], state: WorkflowUiState): string => {
  const selected = runs[state.selectedRunIndex];
  if (state.view === "detail" && selected) {
    return renderWorkflowDetail(selected, { workflowId: workflowIdForRun(selected, runs) });
  }
  return renderWorkflowList(runs, selected?.runId);
};

const keyFromBuffer = (buf: Buffer): WorkflowUiKey | null => {
  const s = buf.toString("utf8");
  if (s === "\u0003" || s === "q") return "q";
  if (s === "\r" || s === "\n") return "enter";
  if (s === "\u001b") return "escape";
  if (s === "\u001b[A") return "up";
  if (s === "\u001b[B") return "down";
  if (s === "r") return "refresh";
  return null;
};

export const runWorkflowTui = async (
  opts: StateOptions & { once?: boolean; input?: NodeJS.ReadStream; output?: NodeJS.WriteStream } = {},
): Promise<void> => {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  let runs = listRuns(opts);
  let state = createWorkflowUiState(runs);
  const render = () => {
    runs = listRuns(opts);
    state = handleWorkflowUiKey(state, runs, "refresh");
    output.write("\x1b[2J\x1b[H");
    output.write(`${renderWorkflowUi(runs, state)}\n`);
  };

  if (opts.once || !input.isTTY || !output.isTTY) {
    output.write(`${renderWorkflowUi(runs, state)}\n`);
    return;
  }

  input.setRawMode(true);
  input.resume();
  render();
  await new Promise<void>((resolve) => {
    const onData = (buf: Buffer) => {
      const key = keyFromBuffer(buf);
      if (!key) return;
      state = handleWorkflowUiKey(state, runs, key);
      if (state.quit) {
        input.setRawMode(false);
        input.pause();
        input.off("data", onData);
        output.write("\n");
        resolve();
        return;
      }
      render();
    };
    input.on("data", onData);
  });
};
