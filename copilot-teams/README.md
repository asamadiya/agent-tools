# copilot-teams

MCP server that gives [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli) Claude-Code-style agent teams: spawn named teammates as **persistent, attachable tmux panes**, address them by name, send follow-ups (`SendMessage`), inspect transcripts (`GetTranscript`), broadcast (`SendToTeam`), and manage their lifecycle (`Pause`, `Resume`, `Restart`, `GC`). The whole pane stays interactive — you can `Attach` and watch any agent live.

## v2 model: panes *are* the agents

A background spawn is a real, persistent `copilot --resume=<uuid> --allow-all-tools` REPL inside a tmux window. The first prompt is typed in via `tmux send-keys` after we observe `session.start` in the session's `events.jsonl`. Follow-ups (`SendMessage`) type into the same pane and wait for the next `assistant.turn_end` — so the user sees turns land exactly where the agent already lives.

```
┌─ your tmux session (or copilot-team-<pid> if you weren't in one) ─┐
│                                                                   │
│  parent copilot                                                   │
│                                                                   │
│  cop:alice  ── copilot --resume=UUID-A --allow-all-tools (REPL)   │
│  cop:bob    ── copilot --resume=UUID-B --allow-all-tools (REPL)   │
│                                                                   │
│  SendMessage{to: "alice", message} → tmux send-keys → turn_end    │
│  Attach{id: "alice"}               → tmux switch-client           │
│  GetTranscript{id: "alice"}        → events.jsonl turns           │
│  TaskOutput{id: "alice"}           → events.jsonl transcript      │
└───────────────────────────────────────────────────────────────────┘
```

## Tools

### Agent lifecycle

| Tool | Purpose |
|------|---------|
| `Agent` | Spawn a sub-Copilot. `run_in_background:false` returns its stdout synchronously; `true` opens a tmux window named `cop:<name|short-uuid>` running an interactive REPL. Optional initial prompt + `wait_first_turn_ms` to capture the first response. |
| `SendMessage` | Send a follow-up to a running agent. Default path = `tmux send-keys` into the pane and await the next `assistant.turn_end`. Provide `model` / `mode` / `allowed_tools` / `denied_tools` / `subprocess: true` to force one-shot subprocess mode (per-turn config override). |
| `Restart` | Stop and respawn an agent with the same config (name, team, model, subagent_type, etc.). |
| `Pause` / `Resume` | `SIGSTOP` / `SIGCONT` the agent's process. |
| `TaskStop` | Kill the tmux window + SIGTERM the pid. |

### Inspection

| Tool | Purpose |
|------|---------|
| `Status` | Deep liveness: events.jsonl-derived state (`missing` / `starting` / `idle` / `busy` / `shutdown`), pane current_command, `ready` boolean. |
| `TaskList` / `TaskGet` | Reconciles against tmux + pid + session-state liveness before returning. Filter by status or team_name. |
| `TaskOutput` | Default `source: "transcript"` returns events.jsonl turns; alternates `pane` (raw scrollback) and `log` (per-uuid log file). |
| `GetTranscript` | Structured turns from events.jsonl: `[{role, content, turnId, timestamp}]`. Optional `since_turn`. |
| `WhoOwns` | Reverse lookup. Given a pane id / uuid / name / tmux_target, return the owning task (or null). |

### Pane management

| Tool | Purpose |
|------|---------|
| `Attach` | `mode: "switch"` (default) brings the agent's pane to the foreground via `tmux switch-client`; `"split"`/`"join"` moves the pane into the current window; `"info"` returns the tmux command without executing. |
| `PaneJoin` | `tmux join-pane -s <agent>`, optionally into a specific window with layout/size/horizontal flags. |
| `PaneBreak` | Inverse — break the pane back out into its own window. |
| `PaneFocus` | Focus the agent's pane in the current client. |
| `PaneResize` | Resize: direction U/D/L/R + cells, or absolute percentage. |
| `PaneSwap` | Swap two agents' panes. |

### Teams + todos

| Tool | Purpose |
|------|---------|
| `TeamCreate` / `TeamDelete` | Create/delete a team. Delete with `force:true` stops live members. |
| `SendToTeam` | Broadcast a message to every running team member (`mode: "broadcast"` or `"first"` for a race). Per-turn config forwarded. Optional concurrency limit. |
| `TaskCreate` / `TaskUpdate` | Plain todo records (status: `todo` / `in_progress` / `completed`). Same state file, different status set — mirrors Claude's overloaded Task* surface. |

### Housekeeping

| Tool | Purpose |
|------|---------|
| `GC` | Removes orphaned `~/.copilot/session-state/<uuid>/` dirs (UUIDs not in our state) and optionally prunes exited tasks older than N hours. `dry_run: true` reports without removing. |

## Streaming progress

Long-running tools (`Agent`, `SendMessage`, `SendToTeam`) emit MCP `notifications/progress` when the client provides `onprogress` (or `_meta.progressToken`). Milestones include `task recorded` → `tmux pane spawned` → `session.start landed` → `initial prompt sent` → `first turn ended`.

## Install

```sh
cd ~/my_stuff/agent-tools/copilot-teams
npm ci && npm run build
bash scripts/postinstall-symlink-agents.sh        # ~/.claude/agents/*.md  →  ~/.copilot/agents/
copilot mcp add agent-teams -- ~/my_stuff/agent-tools/bin/copilot-teams
copilot mcp list                                   # confirm registered
```

## Debug a live session

Live attach via `node --inspect`:

```sh
# Swap bin/copilot-teams for bin/copilot-teams-debug in ~/.copilot/mcp-config.json
chrome://inspect          # → attach to 127.0.0.1:9229
# Set breakpoints in copilot-teams/src/tools/*.ts; trigger a tool call.
```

Logs:
- `~/.copilot/agent-teams/server.log` — structured JSON (pino), one line per tool call with correlation id.
- `~/.copilot/agent-teams/state.json` — canonical task + team state.
- `~/.copilot/agent-teams/locks/<uuid>.lock` — per-uuid mutex (proper-lockfile).
- `~/.copilot/session-state/<uuid>/events.jsonl` — Copilot's own turn log (read-only ground truth).

## Test

```sh
npm test                  # 175+ tests: unit + contract + integration (uses a stub copilot binary)
npm run test:coverage     # coverage with thresholds enforced (state/tmux/copilot ≥90%)
```

## Verification matrix (against real copilot CLI)

Run from inside a tmux session.

```text
1.  copilot mcp list                                 shows agent-teams enabled
2.  Agent fg            "say hi"                     stdout returned
3.  Agent bg + tmux     name=alice, prompt=...       cop:alice REPL appears, attachable
4.  SendMessage         to=alice, "..."              types into pane, returns next turn
5.  subagent_type       researcher                   persona loaded from symlinked .md
6.  Status              id=alice                     state=idle, ready=true, turnCount=N
7.  Attach              mode=switch                  current client jumps to cop:alice
8.  WhoOwns             tmux_target=...              returns task record
9.  GetTranscript       id=alice                     [{role,content,turnId},...]
10. TaskOutput          source=transcript            "[user #0] ... [assistant #0] ..."
11. SendToTeam          team=review, message=...     per-member replies aggregated
12. PaneJoin            id=alice                     pane joins current window
13. Restart             id=alice                     new uuid, same config, fresh REPL
14. Pause / Resume      id=alice                     SIGSTOP / SIGCONT signaled
15. TaskStop            id=...                       kill-window + SIGTERM, status=stopped
16. TeamCreate / Delete force:true                   members stopped, team removed
17. isolation:worktree  in clean repo                runs in detached worktree, auto-cleans
18. GC                  dry_run + real               orphan session-state dirs removed
19. node --inspect      via copilot-teams-debug      DevTools attaches to live server
20. progress stream     SendMessage with onprogress  notifications/progress observed
```
