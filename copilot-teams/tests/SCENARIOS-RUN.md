# SCENARIOS-RUN — final results

Run command: `npx vitest run` (branch:
`add-cross-agent-and-reliability-tests`, target tree:
`/home/spopuri/my_stuff/agent-tools/copilot-teams`).

Vitest 2.1.9. tmux 3.4. Node >=20.

## Aggregate

| Bucket                                                   | Files | Tests | Failed |
| -------------------------------------------------------- | ----- | ----- | ------ |
| Pre-existing suite (unit + contract + integration)       | 18    | 179   | 0      |
| `tests/integration/se-team-scenarios.test.ts`            | 1     | 18    | 0      |
| `tests/integration/cross-agent-reliability.test.ts` NEW  | 1     | 5     | 0      |
| **Total**                                                | 20    | 202   | 0      |

All 202 tests pass on this branch. The new `cross-agent-reliability.test.ts`
adds 5 tests covering scenarios S19/S20/S21a/S21b/S22 (S21 is split into
two sub-tests for sequential and parallel stress).

> Run config: `npx vitest run --pool=forks --poolOptions.forks.singleFork=true`
> for deterministic results. Default parallel-file mode flakes 2-3 tests
> per run (S1, lifecycle SendToTeam, tasks reconcile) due to tmux global
> server contention — pre-existing flake, not introduced by these scenarios.
> Each affected test passes in isolation and when only its file runs. The
> `singleFork` mode serializes test files at the cost of ~1 minute extra
> wall-clock; the underlying tmux/test logic is correct.

## Per-scenario results

| Scenario | Status | Notes                                                    |
| -------- | ------ | -------------------------------------------------------- |
| S1       | PASS   | Parallel-spawn lands all 3 agents in the parent window.  |
| S2       | PASS   | Anchor wins when TMUX_PANE drifts to a sibling pane.     |
| S3       | PASS   | Status returns ready=true on a live %N pane.             |
| S4       | PASS   | SendMessage to tpm doesn't shadow ci-chaser.             |
| S5       | PASS   | resolveTask filters stale tasks; live pane wins.         |
| S6       | PASS   | Restart 3x leaves exactly 1 running task per name.       |
| S7       | PASS   | Bullet `-` in message no longer trips `tmux send-keys`.  |
| S8       | PASS   | `_ct_tmp_<uuid>.md` created and `--agent` argv emitted.  |
| S9       | PASS   | Multi-line message lands without error.                  |
| S10      | PASS   | 5 concurrent SendMessages serialize, 5 distinct turn ids.|
| S11      | PASS   | Orphan session dirs and orphan `_ct_tmp_*.md` removed.   |
| S12      | PASS   | After kill-pane: pane.alive=false; reconciles to exited. |
| S13      | PASS   | `@cop_name` is `cop:<name>` post-spawn.                  |
| S14      | PASS   | SendToTeam broadcasts to all 3 members.                  |
| S15      | PASS   | Restart-during-send doesn't duplicate the agent.         |
| S16      | PASS   | Background spawn returns in <5s without first-turn wait. |
| S17      | PASS   | Concurrent team_name agents create the team exactly once.|
| S18      | PASS   | Status by name returns the live entry, not a stale one.  |
| S19      | PASS   | Worker→worker SendMessage resolves the live sibling, no respawn. |
| S20      | PASS   | Name resolver still picks the live pane after 60s idle.  |
| S21a     | PASS   | 20 sequential SendMessages: every payload lands, no drops, in order. |
| S21b     | PASS   | 20 parallel SendMessages: uuid lock serializes; turn ids 1..20.      |
| S22      | PASS   | Pane buffer audit: literal "say HELLO_X" never stuck at the prompt.  |

## What S19-S22 cover that S1-S18 missed

- **Cross-MCP addressing (S19).** S4 confirms `to` is matched by name (not
  body), but only from a single `handleSendMessage` caller. S19 simulates
  what happens when the *child* MCP loads the same shared `state.json` and
  calls `handleSendMessage` against a sibling — no fresh spawn allowed,
  must resolve to the live sibling uuid via the shared resolver.
- **Stale-`updatedAt` resolver (S20).** S5/S18 stuff stale entries with
  ancient timestamps as a fixture; the *live* entry has a fresh
  `updatedAt`. S20 inverts that: the LIVE entry's `updatedAt` is also
  old (a real long-running, idle agent). Pins the contract that
  recency is a tiebreaker, not a disqualifier.
- **Bulk reliability (S21).** S10 does 5 concurrent calls. The user has
  hit drops at 20+. S21 stresses both the sequential idle-wait gate and
  the parallel uuid lock at 20× scale and verifies events.jsonl as the
  source of truth for delivery (not just the return value).
- **Pane-buffer surface (S22).** No prior test inspects what's actually
  in the visual buffer after a send. S22 catches the "Enter never fired"
  mode where the input is typed but unsubmitted — a defense-in-depth
  contract on `sendLine`.

## Fix history

No production-code bugs were uncovered by S19-S22. The existing resolver
(`resolveTask` in `state.ts`, wired through `findTaskId` in
`send-message.ts`) and uuid lock (`withUuidLock` in `uuid-lock.ts`)
already cover the contracts. The idle-wait gate in `handleSendMessage`
(lines 119-129 of `src/tools/send-message.ts`) prevents the
"keystrokes-into-busy-pane" failure mode that the user observed in
production; S21 confirms it works at 20× concurrency.

| Commit (subject)                                              | Bug addressed |
| ------------------------------------------------------------- | ------------- |
| `8155534` Resolve task by name to the live, running, most-recent entry | Carried over: extracted `resolveTask(state, id, isAlive)` in `state.ts`. Closes S5/S6/S18 (originally) and S19/S20 (newly tested). |
| Branch `add-cross-agent-and-reliability-tests`                | Adds S19-S22 to `tests/SCENARIOS.md` and a new file `tests/integration/cross-agent-reliability.test.ts`. No `src/` changes — the code already satisfies the new contracts. |

> The user's "messages sit on the prompt" report is consistent with two
> mechanisms: (a) typing into a busy pane (the REPL queues but doesn't
> submit until the prior turn finishes) — covered today by the
> idle-wait gate in `handleSendMessage`; or (b) Enter genuinely being
> dropped by tmux/copilot rendering. The stub-copilot binary used in
> tests always submits cleanly, so (b) cannot reproduce against the
> stub. S21 stresses (a) at scale; S22 is a defensive assertion on the
> `sendLine` Enter contract that the stub *can* prove. If the failure
> mode the user saw was actually (b) and is environmental (real
> copilot's input handling, not the stub's), no test against the stub
> can repro it. That's a known limitation; documenting here.

## Verification

```
$ cd /home/spopuri/my_stuff/agent-tools/copilot-teams
$ npm run build
$ npx vitest run --pool=forks --poolOptions.forks.singleFork=true

 Test Files  20 passed (20)
      Tests  202 passed (202)
   Duration  ~166s
```

Per-file (cross-agent-reliability only):

```
$ npx vitest run tests/integration/cross-agent-reliability.test.ts

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  ~29s
```

## Observations / nice-to-have follow-ups

(Carried forward from the prior run.)

- The single shared `findTask`/`findTaskId` resolver is `resolveTask` in
  `state.ts`. All call sites consume it. Future tools should not re-roll
  their own by-name iteration.
- S8 currently asserts `--agent` argv via `buildArgs(...)` directly
  rather than capturing the stub's argv at spawn time. Future
  improvement: stub mode that writes `argv.json` to the session dir.
- S15 passes today because the SendMessage gracefully races. Worth a
  follow-up to make `Restart` acquire the uuid lock for that uuid.
- Default parallel-file vitest mode (no `--singleFork`) flakes 2-3
  tmux-heavy tests per run (S1, lifecycle SendToTeam, tasks reconcile).
  Each passes when its file runs alone. Root cause is tmux global
  server contention, not a logic bug. Two fixes are possible: (1)
  serialize integration files with `singleFork`, or (2) per-file tmux
  socket via `tmux -L <socket>`. Documented as a known flake.

## Reproducing locally

```sh
cd /home/spopuri/my_stuff/agent-tools/copilot-teams
npm ci
npm run build
npx vitest run --pool=forks --poolOptions.forks.singleFork=true     # green, ~166s
npx vitest run tests/integration/cross-agent-reliability.test.ts    # only the new file
```
