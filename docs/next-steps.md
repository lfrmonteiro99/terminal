# Quick Start

## Short answer

- Want a **native desktop app**? Run `./release.sh` (or `make desktop`).
- Want to develop locally? Run `./run.sh` (or `make run`) and open your browser.
- Need to run tests? `docker compose run --rm --profile test test` (or `make test`).

## Commands

```bash
make help           # list available Makefile targets
./run.sh            # start daemon + frontend via docker compose
./run.sh stop       # stop the dev stack
./release.sh        # build and package the Tauri desktop app
make test           # Rust tests (docker) + frontend tests (host)
```

## Development workflow

1. Run `./run.sh` to start the dev environment.
2. Open <http://localhost:5173>.
3. Create a workspace pointing at a project path.
4. Start an AI session and type a prompt — the daemon creates a worktree and
   runs Claude inside it.
5. Review the diff in `PostRunSummary` and merge or revert.

See [`architecture.md`](./architecture.md) for the full picture.

## Roadmap (current)

| Milestone | Status |
|-----------|--------|
| M1 Foundation (state layers, service layer) | ✅ |
| M2 Panes (registry, split layouts, drag-resize) | ✅ |
| M3 Modes (AiSession / Terminal / Git / Browser) | ✅ |
| M4 Terminal (PTY sessions, resize, restore) | ✅ |
| M5 Git (stashes, push/pull, conflicts) | ✅ |
| M6 Browser pane | ✅ |
| M7 Polish (toasts, keybindings, shortcuts) | ✅ |
| M11 Build tooling (`run.sh` / `release.sh` / Makefile) | ✅ |
| M12 Docs refresh | ✅ (this PR) |
| M14 Frontend tests | ✅ |
| M16 Runtime WS URL | ✅ |

## Related docs

- [`architecture.md`](./architecture.md) — crates, daemon, protocol, frontend.
- [`git-flow.md`](./git-flow.md) — git ops surface + panes that consume them.
- [`bin-cc.md`](./bin-cc.md) — optional shell helper for common git workflows.
