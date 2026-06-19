#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { WorkflowRunner } from "./runner.js";
import { inspectWorkflowScript } from "./script.js";
import { renderProgressTree } from "./visibility.js";

const root = process.env.COPILOT_WORKFLOWS_ROOT;
const [cmd, ...args] = process.argv.slice(2);

const print = (v: unknown): void => {
  process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
};

const runner = new WorkflowRunner({ ...(root ? { root } : {}) });

if (cmd === "inspect") {
  const path = args[0];
  if (!path) throw new Error("usage: copilot-workflow inspect <script.js>");
  print(inspectWorkflowScript(readFileSync(path, "utf8")));
} else if (cmd === "run") {
  const path = args[0];
  if (!path) throw new Error("usage: copilot-workflow run <script.js>");
  const launch = await runner.launch({ script: readFileSync(path, "utf8"), confirm: false });
  print(launch);
} else if (cmd === "status") {
  const runId = args[0];
  if (!runId) throw new Error("usage: copilot-workflow status <run-id>");
  const run = runner.status(runId);
  process.stdout.write(`${renderProgressTree(run)}\n`);
} else if (cmd === "output") {
  const runId = args[0];
  if (!runId) throw new Error("usage: copilot-workflow output <run-id>");
  print(runner.output(runId));
} else if (cmd === "stop") {
  const runId = args[0];
  if (!runId) throw new Error("usage: copilot-workflow stop <run-id>");
  print(runner.stop(runId));
} else {
  process.stderr.write("usage: copilot-workflow <inspect|run|status|output|stop> ...\n");
  process.exit(2);
}
