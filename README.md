# agent-tools

Miscellaneous tooling for working with AI coding agents.

## copilot-fork

Fork a [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli) session so the copy can be resumed in a different tmux pane while the original session keeps running. The fork diverges at the moment of the snapshot; the source is left untouched.

### Why

Copilot CLI's `--resume=<uuid>` only resumes an existing session. There is no built-in way to duplicate a session's state so two panes can explore divergent continuations from the same checkpoint. `copilot-fork` does that by cloning the on-disk session state (`~/.copilot/session-state/<uuid>/` and the rows in `~/.copilot/session-store.db`) under a freshly-generated UUID.

### Usage

```
copilot-fork                # fork the most-recently-updated session
copilot-fork <session-id>   # fork a specific session
copilot-fork --list         # list recent sessions with ids, cwd, summary
copilot-fork -h | --help
```

The tool prints the new UUID and the exact `copilot --resume=<uuid>` command to paste into the other pane.

### Install

```
cp bin/copilot-fork ~/.local/bin/    # any directory on $PATH
chmod +x ~/.local/bin/copilot-fork
```

Requires `python3` (stdlib `sqlite3` module).

### Caveats

- **Unofficial.** Reaches into `~/.copilot/` private storage. A Copilot CLI release can change the schema and break this at any time.
- **Snapshot semantics.** The fork is a point-in-time copy. Activity in the source session after the fork does not propagate.
- **Live source.** `events.jsonl` is trimmed to the last complete JSON line in case the source was mid-write. The sqlite copy relies on WAL mode for a consistent read. Forking while the source is idle is safest.

### How it works

1. `cp -a ~/.copilot/session-state/<src>/ ~/.copilot/session-state/<new>/`.
2. Removes any `inuse.*.lock` from the copy so the fork is not treated as "active elsewhere".
3. Rewrites the source UUID to the new UUID inside `events.jsonl` and `workspace.yaml`. This step is essential: Copilot rebuilds session identity from `events.jsonl` (`session.start.data.sessionId` and the `sessionId` field inside every `hook.*` event), so a directory rename alone leaves the fork impersonating the source — `/session-info` shows the old id, and the fork matches the source's lock.
4. Clones rows keyed by `session_id` in `~/.copilot/session-store.db` across the 6 tables Copilot writes to: `sessions`, `turns`, `checkpoints`, `session_files`, `session_refs`, and the FTS5 `search_index`.

## copilot-status-beautifier

A dependency-free Node CLI that renders a power-user HUD status line for the [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli). Designed to be wired in via the CLI's `statusLine` config so every redraw shows project, branch state, context usage, requests, token I/O, and timing in a single dense line.

### Why

Copilot CLI lets you swap in any command for the status line, but you have to write the renderer yourself. This packages a tuned default and an opt-in customization layer so you get a useful HUD with zero config, and can tweak segments without touching the renderer.

### Default output

```
project · branch clean|dirty │ ctx ████░░░░ 42% 12.5k/200k │ req 7 │ in 12.5k cache 18k out 3.4k │ dur 3m spd 37/s
```

Visible by default: project + git (`branch clean|dirty`), `ctx`, `req`, `in/cache/out`, `dur/spd`, recent background-agent activity.
Hidden by default: model name, prompt label, recent tool activity. All toggleable.

### Usage

```
copilot-status-beautifier                 # read status JSON from stdin, print one HUD line
copilot-status-beautifier --demo          # render with a sample payload
copilot-status-beautifier --print-defaults
copilot-status-beautifier --print-config
copilot-status-beautifier --install       # wire as Copilot statusLine in ~/.copilot/config.json
copilot-status-beautifier --uninstall
copilot-status-beautifier -h | --help
```

### Customizations (all off by default)

```
--show <segment>     Force-enable: model, promptLabel, project, git, usage, timing, tools, agents
--hide <segment>     Force-disable a segment
--no-color           Disable ANSI colors
--ascii              Use ASCII glyphs instead of Unicode
--max-width N        Override max width (otherwise auto-detected)
--max-tools N        Limit recent tool entries shown
--max-agents N       Limit recent agent entries shown
--settings <path>    Override settings file (default ~/.copilot/statusline-settings.json)
--state <path>       Override state file (default ~/.copilot/statusline-state.json)
--input <path>       Read status JSON from a file instead of stdin
```

Or persist the same customizations in `~/.copilot/statusline-settings.json`:

```json
{
  "color": true,
  "useUnicode": true,
  "maxWidth": 140,
  "display": {
    "showModel": false,
    "showPromptLabel": false,
    "showProject": true,
    "showGit": true,
    "showUsage": true,
    "showTiming": true,
    "showTools": false,
    "showAgents": true,
    "maxTools": 2,
    "maxAgents": 2
  }
}
```

### Install

```
ln -sfn "$PWD/bin/copilot-status-beautifier" ~/.local/bin/copilot-status-beautifier
copilot-status-beautifier --install      # writes statusLine entry into ~/.copilot/config.json
```

`--install` is idempotent and only touches the `statusLine` key. `--uninstall` removes that key and leaves the rest of `config.json` alone.

Requires Node.js. The shebang in `bin/copilot-status-beautifier` points at a local Volta install of Node 16; edit it to match your environment, or run via `node bin/copilot-status-beautifier`.

### How it works

- Pure stdin → stdout filter; one process per status redraw.
- `lib/render.js` is the renderer (also `require()`-able from other Node code).
- Reads optional state from `~/.copilot/statusline-state.json` (e.g. recent tools, agents, git cache) — no writes if the state file does not exist.
- Git branch + clean/dirty are computed via `git symbolic-ref` + `git status --porcelain`, cached per cwd for a few seconds so redraws stay snappy.
- Adaptive width: shortens lower-priority segments first, then drops optional ones if the terminal is narrow.

### Caveats

- **Unofficial.** Relies on the shape of the status JSON Copilot CLI passes to `statusLine` commands. A CLI release can change the schema and break this.
- **Hooks integration optional.** The recent-tools / recent-agents segments are populated by separate hook scripts that write into `statusline-state.json`. Without them, those segments simply don't render.

## copilot-doctor

Diagnose and fix common GitHub Copilot CLI session issues. The primary feature is **fix-freeze** — a safe, non-invasive repair for the BPE tokenizer freeze that affects long-running or resumed sessions with large `events.jsonl` files (>100MB).

### The Problem

When a Copilot CLI session accumulates a large conversation history (>100MB `events.jsonl`, >40K lines — common with resumed sessions that run background agents), the BPE tokenizer function (`aqi` in the minified `app.js`) enters an O(n²) merge loop that pegs the CPU at 90%+ and starves the Node.js event loop. Symptoms:

- Pane appears frozen — typed characters appear after long delays
- The copilot spinner animates intermittently
- CPU at 80–100% with process state `R` (running, never sleeping)
- The session is NOT crashed — background agents may still be working

### How fix-freeze Works

The fix uses the V8 inspector protocol (Chrome DevTools Protocol) to patch the running process from the outside. The approach was designed through hard-won trial-and-error to be safe for background agents:

```
1. SIGUSR1 → Node.js opens inspector port 9229 (non-intrusive)
2. Debugger.enable → enumerate loaded scripts, find app.js (no pause)
3. Debugger.getScriptSource → locate aqi's while-loop in source
4. Debugger.setBreakpoint with condition "(r.splice(1), false)"
   → conditional BP fires inside the while-loop, truncates merge
     array so loop exits, returns false so NO pause occurs
5. Runtime.terminateExecution → abort the currently stuck aqi call
   → throws a catchable exception that copilot handles gracefully
6. renice 19 + ionice idle → future protection
```

### Safety Design (Lessons Learned)

| Approach | Safe? | Why |
|----------|-------|-----|
| `Debugger.pause` | ❌ | Triggers copilot's cancel detection → stuck "Cancelling" state |
| `Debugger.pause` + socket destroy | ❌ | Kills background agent API streams, agents die |
| `SIGSTOP`/`SIGCONT` throttle | ❌ | Triggers cancel detection when process resumes |
| `SIGINT` to resolve "Cancelling" | ❌ | Kills the entire process including all background agents |
| Conditional breakpoint + `Runtime.terminateExecution` | ✅ | No pause, no signal, no socket interference |

### Usage

```bash
copilot-doctor diagnose 5                          # detailed health check of pane 5
copilot-doctor fix-freeze 5                        # fix frozen pane 5
copilot-doctor status 3                            # quick one-line health status
copilot-doctor fix-jsonl <session-id>              # repair stale locks + corrupted events.jsonl
copilot-doctor fix-jsonl --locks-only <session-id> # only drop stale lock files
copilot-doctor fix-jsonl --force <session-id>      # repair while owner is live (DANGEROUS)
copilot-doctor -h                                  # full help
```

### When `copilot --resume <id>` returns nothing → `fix-jsonl`

> **Agents:** if the user reports that `copilot --yolo --resume <session-id>` exits silently, hangs, or returns nothing, **run `copilot-doctor fix-jsonl <session-id>`** before doing anything else. It is idempotent and prints "already clean" when there's nothing to fix.

This is by far the most common cause of "I can't resume my session" reports. Two failure modes, both fixed automatically:

1. **Stale `inuse.<pid>.lock` files** left after a tmux/pod/host crash. Copilot's "alreadyInUse" check sees these and refuses to attach. `fix-jsonl` removes lock files whose pids are dead, and refuses (without `--force`) when a live copilot still owns the session.
2. **Torn `events.jsonl` lines** when a write was interrupted mid-flush — typically a partial event followed by a complete event glued onto the same line. `fix-jsonl` first tries a two-way split (keep both halves if both parse), falls back to dropping the truncated prefix and keeping the longest valid suffix. Multi-event concatenations are handled.

Backups are timestamped (`events.jsonl.before-repair.<unix-ts>`) so previous repairs are never overwritten. Original `0600` permissions are preserved.

### Install

```bash
ln -sfn "$PWD/bin/copilot-doctor" ~/.local/bin/copilot-doctor
pip3 install websockets    # required for V8 inspector communication
```

### Subcommands

| Command | Description |
|---------|-------------|
| `diagnose [pane]` | Full health check: CPU, memory, events.jsonl size, process state, background agents, network. Suggests fixes. |
| `fix-freeze [pane]` | Patches the BPE tokenizer via V8 inspector. Safe for background agents. |
| `fix-jsonl <id>` | Repairs stale `inuse.*.lock` files **and** corrupted `events.jsonl` (concatenated lines, torn writes) — the standard fix when `copilot --resume` returns nothing. Refuses if a live copilot owns the session unless `--force`. Idempotent: prints "already clean" when there's nothing to do. Timestamped backups. |
| `status [pane]` | One-line health indicator (🟢 HEALTHY / 🟡 DEGRADED / 🔴 FROZEN). |

### Side Effects of fix-freeze

- **"Cancelling" state may appear.** `Runtime.terminateExecution` throws an exception that can trigger copilot's cancel detection. This is cosmetic and temporary — the session remains functional. **DO NOT** attempt to fix it by sending SIGINT or Ctrl+C (this kills the process). Wait for background agents to finish, or resume the session with `--resume`.
- **Token counting over-estimates.** The patched tokenizer skips BPE merges, so each character is counted as a separate token. The context bar (%) reads higher than reality. This is cosmetic — it does not affect the actual API calls or context window.
- **"Debugger attached/ending" messages** appear in the pane. These are from the inspector connection and are harmless cosmetic noise.
- **Inspector port 9229** remains open until the session ends. Not a security risk on localhost but be aware if port-forwarding.
- **renice 19** is applied to the copilot process, giving it lowest scheduling priority. This helps prevent future freezes from starving the event loop.

### Cautions

- **Unofficial.** Reaches into V8 internals. Node.js or Copilot CLI updates can break this.
- **Function name `aqi` is minified.** A new Copilot CLI release may rename it. The tool searches for `function aqi(` in `app.js` — if the name changes, `fix-freeze` will report an error and exit without making changes.
- **`Runtime.terminateExecution` throws an exception** in the running JS. Copilot's error handler catches it, but it means the in-progress token count fails. Copilot retries or uses a fallback.
- **Run `diagnose` first** if you're unsure whether the issue is a tokenizer freeze. Not all freezes have the same root cause.

### Requirements

- `tmux` (for pane resolution)
- `python3` with `websockets` package
- `strace` (optional, for deep diagnostics in `diagnose`)
- `bc` (for CPU threshold arithmetic)
- Linux (uses `/proc` filesystem, `ss`, `renice`, `ionice`)
