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
