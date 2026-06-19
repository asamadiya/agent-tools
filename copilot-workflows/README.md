# copilot-workflows

Dynamic workflow runner for GitHub Copilot CLI agents.

Use this when a prompt says `workflow: <goal>` or when a task benefits from multiple isolated agents with visible phases, transcripts, and resumable JS orchestration.

## Tools

- `Workflow` runs a generated or persisted workflow JS file.
- `WorkflowStatus` shows live phase and agent progress.
- `WorkflowOutput` returns the final result, journal, and per-agent transcripts.
- `WorkflowStop` cancels a run.
- `WorkflowInspect` validates a script without running it.

Default agent config is GPT-5.5, xhigh effort, 1.1M context. Override globally, per workflow, per phase, or per agent.

## Test

```sh
npm test
npm run typecheck
npm run build
```

Real-model smoke tests are opt-in only; normal tests use deterministic stub agents.
