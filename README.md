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
