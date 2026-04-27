# SCENARIOS-RUN — final results

Run command: `npx vitest run` (branch: `fix-se-team-scenarios`, target tree:
`/home/spopuri/my_stuff/agent-tools/copilot-teams`).

Vitest 2.1.9. tmux 3.4. Node >=20.

## Aggregate

| Bucket                                             | Files | Tests | Failed |
| -------------------------------------------------- | ----- | ----- | ------ |
| Pre-existing suite (unit + contract + integration) | 18    | 179   | 0      |
| New `tests/integration/se-team-scenarios.test.ts`  | 1     | 18    | 0      |
| **Total**                                          | 19    | 197   | 0      |

All 197 tests pass on `main` after the architect's 18 SE-team scenarios are
folded in. The architect's first-run report flagged S5/S6/S18 as failing on
their worktree, but they had branched from a commit that pre-dated `8155534`
("Resolve task by name to the live, running, most-recent entry"), so they
never observed the fix. Running the same 18 scenarios against the tip of
`main` confirms `8155534`'s `resolveTask(state, id, isAlive)` helper closes
all three bugs without further code changes.

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

## Fix history

The architect's three flagged failures (S5, S6, S18) were already addressed
on `main` by commit `8155534` before this branch was opened. No additional
production-code commits were required on `fix-se-team-scenarios`; the only
commits on this branch import the architect's deliverables and update the
run report.

| Commit (subject)                                              | Bug addressed |
| ------------------------------------------------------------- | ------------- |
| `8155534` Resolve task by name to the live, running, most-recent entry | Pre-existing on main: extracted `resolveTask(state, id, isAlive)` in `state.ts`, wired through SendMessage, Status, Attach, Restart, Pause, Resume, and every Pane* tool. Closes S5 (findTaskId picked oldest stale), S6 (Restart picked stopped sibling, leaving N running after N restarts), and S18 (Status by name picked stale entry). |
| Branch import commit (this PR)                                | Brings architect's `tests/SCENARIOS.md`, `tests/integration/se-team-scenarios.test.ts`, and `tests/SCENARIOS-RUN.md` onto `main`; refreshes run report to reflect 197/197 passing. |

## Verification

```
$ cd /home/spopuri/my_stuff/agent-tools/copilot-teams
$ npm run build
$ npx vitest run

 Test Files  19 passed (19)
      Tests  197 passed (197)
```

## Observations / nice-to-have follow-ups

(Carried forward from the architect's report — these remain valid.)

- The single shared `findTask`/`findTaskId` resolver is now `resolveTask`
  in `state.ts`. All call sites consume it. Future tools should not
  re-roll their own by-name iteration.
- S8 currently asserts `--agent` argv via `buildArgs(...)` directly rather
  than capturing the stub's argv at spawn time. That's a sufficient
  contract for the pure-TS argv composition path, but a future improvement
  would be a stub mode that writes `argv.json` to the session dir so we
  can assert the actual spawn argv.
- S15 passes today because the SendMessage gracefully races (the kill
  closes the pane mid-send, the awaitTurnEnd polls the events.jsonl, and
  the `timeout_ms: 8000` bound keeps the test from hanging). If a future
  refactor makes Restart acquire the uuid lock, S15 should still pass —
  but the test would tighten naturally (no timeout needed). Worth a
  follow-up to make Restart take the uuid lock for that uuid.
- S1 takes ~24s on the first run because the parent pane opens with a
  fresh shell that has to print its prompt before tmux's split-window
  succeeds repeatedly. Not a real-world concern (real copilot startup
  dominates).

## Reproducing locally

```sh
cd /home/spopuri/my_stuff/agent-tools/copilot-teams
npm ci
npm run build
npx vitest run                                                # full suite
npx vitest run tests/integration/se-team-scenarios.test.ts    # only new file
```
