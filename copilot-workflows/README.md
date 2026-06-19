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

Default agent config is GPT-5.5, xhigh effort, 1.1M context. Override globally, per workflow, per phase, or per agent.

## Test

```sh
npm test
npm run typecheck
npm run build
```

Real-model smoke tests are opt-in only; normal tests use deterministic stub agents.
