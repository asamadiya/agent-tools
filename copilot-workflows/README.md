# copilot-workflows

Dynamic workflow runner for GitHub Copilot CLI agents.

Use this when a prompt says `workflow: <goal>` or when a task benefits from multiple isolated agents with visible phases, transcripts, and resumable JS orchestration.

## Tools

- `Workflow` runs a generated or persisted workflow JS file. By default (`wait:false`) it launches the run in the background and returns immediately with `runId`/`scriptPath`/`transcriptDir`; poll `WorkflowStatus` for completion or pass `wait:true` to run synchronously. Requires `confirm:false` to launch.
- `WorkflowStatus` shows live phase and agent progress.
- `WorkflowOutput` returns the final result, journal, and per-agent transcripts.
- `WorkflowStop` cancels a run.
- `WorkflowInspect` validates a script without running it.
- `WorkflowList` lists runs, optionally filtered by status or workflow name.
- `WorkflowSave` validates and persists a script as a queued run without executing it.

## Workflow UX

Workflow responses include Claude Code-style terminal views:

- `workflowListText` shows numbered workflow rows (`WF1`, `WF2`, ...) so multiple runs can be distinguished.
- `detailView` shows a split view: phases on the left, agent/task rows on the right, plus the selected task's prompt, current activity, and outcome.
- `WorkflowStatus` accepts optional `selectedPhase` and `selectedAgent` fields to render a focused detail view for a specific phase or task.

For an actual interactive terminal view, run:

```sh
copilot-workflow ui
```

Use ↑/↓ to select a workflow, Enter to open the detail table, Esc to return to the list, `r` to refresh, and `q` to quit. Use `copilot-workflow ui --once` for a non-interactive snapshot.

Inside Copilot CLI, the project extension registers `/workflows`. When the host supports canvases it opens a native canvas; in tmux-based CLI sessions it falls back to a tmux popup over the current Copilot pane.

Default agent config is GPT-5.5, xhigh effort, 1.1M context. Override globally, per workflow, per phase, or per agent.

### Agent `permissions`

An `agent()` step's `permissions` option maps to the copilot CLI `--mode` flag, which only supports `interactive|plan|autopilot`:

- `default` → omits `--mode` (copilot's interactive default)
- `auto` → `autopilot`
- `plan` → `plan`
- `dontAsk` / `bypassPermissions` → unsupported; the run fails fast instead of forwarding an invalid flag.

## Test

```sh
npm test
npm run typecheck
npm run build
```

Real-model smoke tests are opt-in only; normal tests use deterministic stub agents.
