# SE-team scenario test plan — `copilot-teams`

End-to-end "what an admin copilot actually does" scenarios. Each scenario
pins at least one production bug or design assumption listed in the test-
architect brief. Implementations live in
`tests/integration/se-team-scenarios.test.ts`.

Conventions:

- `tmux session`: `ct-se-<pid>-<short-uuid>`, created and torn down per test.
- A "parent pane" inside that session is the test's stand-in for the admin's
  copilot pane. `process.env.TMUX_PANE` is set to it before invoking
  `handleAgent`.
- Each scenario uses its own `statePath`, `sessionRoot`, and `STUB_COPILOT_DIR`
  in `os.tmpdir()`.
- The stub copilot at `tests/integration/fixtures/stub-copilot` is used as
  `--binary`. It writes events.jsonl and supports `say X`, `remember K=V`,
  `what is K?`.

Status legend for the post-run pass: `✅ PASS`, `❌ FAIL`, `⏭️ SKIP`.

---

## S1 — parallel-spawn chains off a single anchor ✅ PASS

**Story.** Admin fires three `Agent` calls in parallel for `tpm`, `tech-fellow`,
and `ci-chaser`. They must all land in the same window, with the parent pane
on the left and the three agents stacked on the right (one horizontal split,
two vertical splits below it).

**Setup.** Fresh state, fresh session, parent pane created via
`tmux split-window` and exported via `TMUX_PANE`.

**Steps.**

1. `Promise.all([Agent(tpm), Agent(tech-fellow), Agent(ci-chaser)])`.

**Expected.**

- All three calls return distinct `tmuxTarget` pane ids.
- All three panes share the parent's `window_id`.
- `state.anchor.paneId` equals the parent pane.
- Pane geometry: at most one pane is `horizontal=true` (the first agent or
  parent->first-agent split); the rest are vertical splits stacked in the
  right column. Concretely, exactly one horizontal split was performed (the
  first agent), and the remaining two are vertical splits inside the right
  column.

**Why it would regress.** Bugs (1) parallel races both falling back to
`TMUX_PANE`, and (6) layout drift when only the anchor survives. If the spawn
lock is removed or the right-column heuristic changes, each agent would split
the parent (giving 3 horizontal splits), or the agents would tile randomly.

---

## S2 — focus drift: anchor wins over `TMUX_PANE` ✅ PASS

**Story.** Admin spawns `tpm`. Then she focuses an unrelated pane in the same
window (simulating the MCP server respawning under a different `TMUX_PANE`).
She spawns `ci-chaser`. The new agent must chain off the anchor's column,
not the focus pane.

**Setup.** Same session as S1. Create an extra "distraction" pane in the
window that is NOT the anchor.

**Steps.**

1. Spawn `tpm` with `TMUX_PANE = parentPane`.
2. Switch `TMUX_PANE` to the unrelated distraction pane.
3. Spawn `ci-chaser`.

**Expected.**

- `ci-chaser`'s parent pane (queried via `display-message #{pane_at_top}`
  or by reading the pane tree) is `tpm`'s pane (the most-recent live agent),
  not the distraction pane.
- `state.anchor.paneId` still equals the original parent.

**Why it would regress.** Bug (2) MCP respawns inheriting current pane.
Without the anchor-then-chain resolution, `ci-chaser` would split the
distraction pane and orphan the team layout.

---

## S3 — Status reports ready on a live `%N` pane ✅ PASS

**Story.** Admin asks "is the team ready?" via `Status` on each member.
None of them should trigger a re-spawn, and `ready=true` for live, idle agents.

**Setup.** Spawn one agent and let it complete the first turn.

**Steps.**

1. `Agent({prompt: "say boot", wait_first_turn_ms: 5000})`.
2. `Status({id: name})`.

**Expected.**

- `s.session.state === "idle"`.
- `s.pane.alive === true`.
- `s.ready === true`.
- No new tasks created in state (`Object.keys(state.tasks).length === 1`).

**Why it would regress.** Bug (7) — a forgotten branch in pane-id check
returned `ready: false`, prompting the model to respawn.

---

## S4 — name-shadowing: SendMessage to `tpm` doesn't shadow `ci-chaser` ✅ PASS

**Story.** Admin tells `tpm`: "track ci-chaser." `SendMessage` must address
`tpm` (the receiver), not `ci-chaser` (a separate teammate referenced in the
message body).

**Setup.** Spawn both `tpm` and `ci-chaser` as background agents.

**Steps.**

1. Spawn `tpm`, `ci-chaser`.
2. `SendMessage({to: "tpm", message: "remember tracked=ci-chaser"})`.
3. `SendMessage({to: "tpm", message: "what is tracked?"})`.

**Expected.**

- The reply for the second message is `ci-chaser` (i.e. the kv landed on
  `tpm`'s session, not `ci-chaser`'s).
- `ci-chaser`'s events.jsonl shows zero user messages.

**Why it would regress.** Confirms `findTaskId` resolves only by the `to`
field, not by content scanning. If someone added body parsing this would
break.

---

## S5 — many-stale: `findTaskId` picks the live, most-recent pane ❌ FAIL

**Story.** State accumulates 8 stale `running` entries for the name
`tech-fellow` (left over from prior crashed sessions). The newest entry is
the only one with a live tmux pane. SendMessage must resolve to the live one.

**Setup.** Pre-populate `state.json` with 7 stale tasks named `tech-fellow`,
all `status: "running"` but with non-existent pane ids and old timestamps.
Then spawn a real `tech-fellow`.

**Steps.**

1. Hand-write 7 stale entries.
2. Spawn the live one.
3. `SendMessage({to: "tech-fellow", message: "say I_AM_LIVE"})`.

**Expected.**

- `result.output === "I_AM_LIVE"`.
- The send went via `send-keys`, not `subprocess` (live pane existed).
- The resolved id matches the live spawn's id, not any of the stale ones.

**Why it would regress.** Bug (3) `findTaskId` returns oldest match. Without
"prefer running, then most-recent live pane" semantics, SendMessage types
into a dead pane and hangs.

> NOTE: this test will FAIL on the current code if `findTaskId` does not
> filter to running tasks with live panes. That is intentional — it pins the
> bug. The fix-agent will update the resolver.

---

## S6 — Restart 3x: pane reused, uuid changes ❌ FAIL

**Story.** Admin restarts the same agent three times. Each restart must
reuse the same tmux pane id (no orphans) and produce a fresh uuid.

**Setup.** Spawn one background agent, then call `Restart` three times.

**Steps.**

1. `Agent({prompt: "say boot", name: "rst", run_in_background: true,
   wait_first_turn_ms: 5000})`.
2. Loop 3x: `Restart({id: "rst"})`.

**Expected.**

- All three restarts return the same `tmuxTarget` (pane id) as the original.
- Each restart returns a different `id` (uuid).
- Final state has the latest restart in `running`; the prior records are
  `stopped`.

**Why it would regress.** Bug (5) restart creating a new pane.

---

## S7 — bullet-line persona doesn't error tmux ✅ PASS

**Story.** A persona prompt contains lines beginning with `-` (markdown
bullets, e.g. `- review code`). `sendLine` must NOT fail with
`invalid flag -`.

**Setup.** Spawn a fresh background agent with no prompt.

**Steps.**

1. `Agent({name: "bullet", run_in_background: true})`.
2. `SendMessage({to: "bullet", message: "- review code\n- write tests"})`.

**Expected.**

- No error thrown.
- `result.output` is a non-empty string (stub returns `STUB_OK: ...`).
- The agent's events.jsonl contains a `user.message` with the bullet body.

**Why it would regress.** Bug (4) — `tmux send-keys -l` rejects content
starting with `-`. Fixed via the `--` getopt terminator in `sendLiteral`.

---

## S8 — multi-line system prompt: `_ct_tmp_<uuid>.md` + `--agent` wiring ✅ PASS

**Story.** Admin spawns an agent with an inline `system_prompt`. The server
must materialize a temp persona file under `~/.copilot/agents/` and pass
`--agent _ct_tmp_<uuid-no-dashes>` to the spawn.

**Setup.** Foreground agent (so we can capture stub args via the events
file or an env-injected wrapper).

**Steps.**

1. `Agent({prompt: "say x", system_prompt: "You are TURTLE.\n- be terse\n- no fluff",
   run_in_background: false})`.

**Expected.**

- File exists at `~/.copilot/agents/_ct_tmp_<uuid-no-dashes>.md` with the
  persona body.
- The spawn arglist (recoverable via stub-emitted argv probe — see
  `STUB_ARGV_FILE` env hook below) contains `--agent _ct_tmp_<uuid-no-dashes>`.

**Why it would regress.** Bug (10) — system_prompt materialization and
`--agent` wiring.

> The stub doesn't yet write its argv. The test reads the persona file and
> separately verifies `buildArgs(...)` returns the expected `--agent` flag
> for the same input. (Pure-unit assertion of argv composition.)

---

## S9 — multi-line prompt via `S-Enter` then submit ✅ PASS

**Story.** A prompt with internal `\n` must be sent as Shift+Enter for soft
breaks, then a single trailing Enter to submit. The pane should receive all
three lines without prematurely submitting.

**Setup.** Background agent.

**Steps.**

1. Spawn background `multi`.
2. `SendMessage({to: "multi", message: "say first\nsay second"})` — note
   the stub responds to `say X` so the *last line* is what becomes the reply
   for the single REPL turn (since copilot only parses the trailing line as
   the user message anyway). The contract we test here is "no error;
   events.jsonl has exactly ONE user.message containing both lines joined by
   `\n`."

**Expected.**

- `result.output` is non-empty.
- events.jsonl has a single `user.message` for that turn whose `content`
  contains `"\nsay second"` (i.e. the soft break landed as a literal newline
  in the buffer).

**Why it would regress.** Bug (11) — multi-line prompts via `S-Enter`.

---

## S10 — concurrent SendMessages serialize via uuid lock ✅ PASS

**Story.** Five `SendMessage` calls fire in parallel against the same agent.
The uuid lock must serialize them; each gets a distinct turn_id and the
right reply.

**Setup.** Background agent.

**Steps.**

1. Spawn `seq` with `wait_first_turn_ms`.
2. `Promise.all` of 5 `SendMessage({to: "seq", message: "say <K>"})`.

**Expected.**

- All five complete without error.
- `outputs.sort() === ["A","B","C","D","E"]`.
- `turnIds` are unique and a permutation of `[1,2,3,4,5]`.

**Why it would regress.** Confirms `withUuidLock` actually serializes; if
the lock is replaced with a no-op, two concurrent send-keys collide and the
REPL drops keystrokes.

---

## S11 — GC touches only orphans ✅ PASS

**Story.** GC must remove session-state dirs and persona files whose UUIDs
don't appear in the current `state.json`. It must NOT touch dirs/files for
known live tasks.

**Setup.** Hand-craft state with one known uuid; create one orphan session
dir, one orphan persona file, and matching ones for the known uuid.

**Steps.**

1. Pre-populate state, sessionRoot, and a fake `~/.copilot/agents` test dir
   (we use the real homedir but keep the orphan file name unique to the test).
2. `Gc({dry_run: false})`.

**Expected.**

- Orphan session dir is removed.
- Orphan persona file is removed.
- Known session dir survives.
- Known persona file survives.

**Why it would regress.** Bug GC-related — confirms `handleGc` filters by
`knownUuids` correctly.

---

## S12 — kill-pane → reconciliation marks task exited ✅ PASS

**Story.** Admin manually `tmux kill-pane`s an agent's pane. Subsequent
`Status` must report `pane.alive=false`, and `TaskList` must reconcile the
task to `exited`.

**Setup.** Background agent.

**Steps.**

1. Spawn `dropme`.
2. `tmux kill-pane -t <target>`.
3. `Status({id: "dropme"})` — expect `pane.alive=false`, `ready=false`.
4. `TaskList()` — expect status `exited`.

**Expected.** As above.

**Why it would regress.** Confirms `paneExists` + `reconcileTask` chain.

---

## S13 — pane border shows `cop:<name>` after copilot's title escape ✅ PASS

**Story.** Copilot CLI emits an OSC title-set escape ("GitHub Copilot") on
startup, overwriting `pane_title`. The server sets a pane-local
`@cop_name` user option that copilot can't touch and references it in
`pane-border-format`. After spawn, querying `@cop_name` on the agent's pane
must return the expected `cop:<name>`.

**Setup.** Background agent.

**Steps.**

1. Spawn `bordertest`.
2. `tmux show-options -pv -t <target> @cop_name`.

**Expected.**

- The output equals `cop:bordertest`.

**Why it would regress.** Bug (8) — copilot overrides pane_title; the
@cop_name option is the workaround.

---

## S14 — SendToTeam broadcast hits all live members ✅ PASS

**Story.** Three agents join `team-x`. SendToTeam broadcasts a message;
all three receive it and reply.

**Setup.** Three background agents joined to `team-x`.

**Steps.**

1. Spawn `m1`, `m2`, `m3` with `team_name: "team-x"`.
2. `SendToTeam({team: "team-x", message: "say HELLO"})`.

**Expected.**

- `r.results.length === 3`.
- Every entry has `output === "HELLO"`.

**Why it would regress.** Confirms team membership and broadcast fan-out.

---

## S15 — restart while busy: no race, no duplicate ✅ PASS

**Story.** A restart fires while a previous SendMessage is mid-flight. The
restart must wait its turn — not duplicate the agent or race the pane state.

**Setup.** Background agent.

**Steps.**

1. Spawn `racy`.
2. Kick off `SendMessage({to: "racy", message: "say slowboat"})` (don't
   await).
3. Immediately call `Restart({id: "racy"})`.
4. Await both.

**Expected.**

- Both calls eventually complete.
- After both settle, exactly one task is `running` for the name `racy`.
- The pane id of the running task equals the original pane (respawn-pane in
  place — same visual slot).

**Why it would regress.** Bug (15) — restart-on-busy duplicating panes or
racing the lock.

---

## S16 — non-blocking spawn: Agent returns fast even when copilot start lags ✅ PASS

**Story.** Without `wait_first_turn_ms`, `handleAgent` should return in
~hundreds of ms even if the cold-start would normally take much longer. It
should NOT block on `awaitSessionReady`.

**Setup.** Background agent, no `wait_first_turn_ms`.

**Steps.**

1. Record `start = Date.now()`.
2. `Agent({prompt: "say x", run_in_background: true})`.
3. Record `dur`.

**Expected.**

- `out.status === "running"`.
- `dur < 5000`. (Stub starts fast; real copilot would too.)
- `out.firstTurnId === undefined`.
- `out.output === undefined`.

**Why it would regress.** Bug (9) — `awaitSessionReady` blocking the spawn
for up to 120s.

---

## S17 — concurrent Agent calls with the same `team_name` create the team once ✅ PASS

**Story.** Three parallel Agent calls all carry `team_name: "fast"`. The
team record must be created exactly once; all three members must be joined.

**Setup.** Fresh state, parent pane.

**Steps.**

1. `Promise.all([Agent({team_name: "fast", name: "f1"}), Agent({...f2}),
   Agent({...f3})])`.

**Expected.**

- `state.teams["fast"]` exists with a single `createdAt` timestamp.
- All three task records carry `team === "fast"`.
- Three distinct pane ids.

**Why it would regress.** Confirms TeamCreate idempotency under spawn-lock
serialization.

---

## S18 — Status by name when many same-name entries exist (resolver) ❌ FAIL

**Story.** State has many `tech-fellow` entries (from S5 setup). `Status({id:
"tech-fellow"})` must return the live one, not a stale one.

**Setup.** Reuse the S5 fixture pattern.

**Steps.**

1. 7 stale `tech-fellow`, 1 live spawn.
2. `Status({id: "tech-fellow"})`.

**Expected.**

- `s.id` equals the live spawn's uuid.
- `s.ready === true`.

**Why it would regress.** Same name-resolver bug as S5, but observable from
`Status`. Pins the resolver in `tools/status.ts`.

---

## Coverage matrix

| #   | Bug pinned                                    | Source area                  |
| --- | --------------------------------------------- | ---------------------------- |
| S1  | parallel race (1), layout drift (6)           | agent.ts spawn lock & layout |
| S2  | MCP respawn pane drift (2)                    | agent.ts anchor resolution   |
| S3  | Status ready=false on live `%N` (7)           | tools/status.ts              |
| S4  | content-scan resolver (assumption)            | send-message.ts findTaskId   |
| S5  | many-stale running, oldest wins (3)           | send-message.ts findTaskId   |
| S6  | restart orphan (5)                            | lifecycle.ts handleRestart   |
| S7  | bullet `-` rejected (4)                       | tmux.ts sendLiteral          |
| S8  | system_prompt materialization (10)            | agent.ts                     |
| S9  | multi-line S-Enter (11)                       | tmux.ts sendBlock            |
| S10 | uuid lock serializes                          | uuid-lock.ts                 |
| S11 | GC orphan-only sweep                          | lifecycle.ts handleGc        |
| S12 | reconcileTask on pane death                   | tools/tasks.ts               |
| S13 | @cop_name vs OSC title (8)                    | agent.ts post-split           |
| S14 | SendToTeam broadcast                          | lifecycle.ts handleSendToTeam|
| S15 | restart-while-busy race                       | lifecycle.ts handleRestart   |
| S16 | non-blocking spawn (9)                        | agent.ts (no awaitReady)     |
| S17 | concurrent Agent + team_name idempotent       | agent.ts spawn lock          |
| S18 | name resolver picks live entry                | status.ts findTask           |
