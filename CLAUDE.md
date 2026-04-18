# Terminal Engine — Project Instructions

> **Long-form docs**: [`docs/architecture.md`](./docs/architecture.md) ·
> [`docs/git-flow.md`](./docs/git-flow.md) ·
> [`docs/next-steps.md`](./docs/next-steps.md) ·
> [`docs/bin-cc.md`](./docs/bin-cc.md) (optional shell helper, not the app).
>
> **Contributor guides**: [`docs/modes.md`](./docs/modes.md) ·
> [`docs/panes.md`](./docs/panes.md) ·
> [`docs/workspaces.md`](./docs/workspaces.md) ·
> [`docs/keybindings.md`](./docs/keybindings.md) ·
> [`docs/ux-conventions.md`](./docs/ux-conventions.md) ·
> [`docs/naming-conventions.md`](./docs/naming-conventions.md).

## Workspace

Three crates in `crates/`:

| Crate | Role |
|-------|------|
| `terminal-core` | Shared types, protocol (`AppCommand`/`AppEvent`), domain models (`Workspace`, `PaneLayout`, `WorkspaceMode`), `DaemonConfig`, `DaemonMode` |
| `terminal-daemon` | Library (`lib.rs`) + standalone binary (`main.rs`). Axum WS server, `DaemonContext`, domain dispatchers, PTY manager, git engine, persistence |
| `terminal-app` | Tauri v2 native shell. Embeds daemon in-process via `terminal_daemon::start_server()` |

Frontend: `frontend/` — React 19 + TypeScript + Vite.

## Building & Testing

**Always use Docker for Rust builds** (Windows host lacks native toolchain setup):

```bash
docker compose run --rm test                          # Rust tests
docker compose run --rm test cargo check -p terminal-app  # Tauri crate check
```

Frontend builds run on host:
```bash
cd frontend && npm run build
```

Rust MSRV: **1.88** (required by `time` crate). Dockerfiles use `rust:1.88-slim`.

## Architecture Overview

### Daemon Architecture

The daemon uses a domain-dispatcher pattern:

```
server.rs (Axum WS) → Dispatcher (router) → DaemonContext (shared state)
                                          ↳ WorkspaceDispatcher
                                          ↳ GitDispatcher
                                          ↳ PtyManager (terminal sessions)
```

- **`DaemonContext`** (`daemon_context.rs`) — shared state (sessions, active_runs, workspaces, PTY channels, persistence)
- **`dispatchers/workspace_dispatcher.rs`** — workspace lifecycle (create/close/activate)
- **`dispatchers/git_dispatcher.rs`** — extended git ops (push/pull/fetch, merge conflicts)
- **`pty/manager.rs`** — PTY session lifecycle (subprocess with piped stdin/stdout)

### Frontend Architecture

```
App.tsx → AppChrome (header) + WorkspaceSwitcher + PaneRenderer
                                                 ↳ AiRunPane
                                                 ↳ TerminalPane
                                                 ↳ GitStatusPane + GitHistoryPane
                                                 ↳ BrowserPane
```

**State layers** (M1-02):
- `state/app-store.ts` — global: connection, sessions, workspaces
- `state/workspace-store.ts` — per-workspace: runs, output, sidebar, terminal sessions

**Service layer** (M1-03):
- `core/commands/commandBus.ts` — decouples UI from raw protocol
- `core/events/eventRouter.ts` — routes daemon events to correct state layer
- `core/services/*.ts` — domain services (session, run, git, workspace, terminal)

**Pane system** (M2):
- `panes/registry.ts` — maps `PaneKind` → React component
- `panes/PaneRenderer.tsx` — recursive layout tree renderer with drag-resize
- `panes/ai-run/AiRunPane.tsx`, `panes/terminal/TerminalPane.tsx`, etc.

**Mode system** (M3):
- `modes/registry.ts` — `ModeDefinition` registry
- `modes/definitions.ts` — AiSession / Terminal / Git / Browser definitions

## Domain Models

### Workspace + Pane Models (`terminal-core/src/models.rs`)
- `Workspace`, `WorkspaceSummary`, `WorkspaceMode` (AiSession/Terminal/Git/Browser)
- `PaneLayout` (recursive: `Single(PaneDefinition)` | `Split { direction, ratio, first, second }`)
- `PaneKind` (AiRun/Terminal/GitStatus/GitHistory/FileExplorer/Browser/Diff)
- `TerminalSessionMeta`, `TerminalSessionSummary`, `RestorableTerminalSession`
- `MergeConflictFile`

### Protocol (`terminal-core/src/protocol/v1.rs`)
Commands and events are flat enums with `#[serde(tag = "type")]`.

Key domain groups:
- **Auth**: `Auth` → `AuthSuccess/AuthFailed`
- **Session**: `StartSession/EndSession/ListSessions`
- **Run**: `StartRun/CancelRun/RespondToBlocking/...`
- **Git**: `GetRepoStatus/StageFile/.../PushBranch/PullBranch/FetchRemote/GetMergeConflicts/ResolveConflict`
- **Workspace**: `ListWorkspaces/CreateWorkspace/CloseWorkspace/ActivateWorkspace`
- **PTY**: `CreateTerminalSession/CloseTerminalSession/WriteTerminalInput/ResizeTerminal`

## Key Patterns

- **DaemonMode::Standalone** — writes port/token to `~/.terminal-daemon/`. Used by CLI/Docker.
- **DaemonMode::Embedded** — in-memory only, no file writes. Used by Tauri app.
- **Channels**: `mpsc` for commands (client→dispatcher), `broadcast` for events (dispatcher→clients, workspace-scoped available), `oneshot` for shutdown.
- **Workspace channels** — each workspace gets its own `broadcast::Sender<String>` for event isolation (M1-05). Falls back to global channel.
- **Git operations**: Pure CLI via `tokio::process::Command`. No libgit2.
- **Persistence**: Atomic JSON writes (`.tmp` → rename). Crash recovery on startup. Subdirs: `sessions/`, `runs/`, `worktrees/`, `terminals/`.
- **Error handling**: `Result<T, Box<dyn Error + Send + Sync>>` at boundaries. `thiserror` for typed errors. No `unwrap()` in `start_server()`.
- **PTY sessions**: Real PTY via openpty(2). Terminal resize via `ioctl(TIOCSWINSZ)`. Linux `/proc/<pid>/cwd` for cwd tracking.

## Conventions

- Workspace dependencies in root `Cargo.toml` — use `dep.workspace = true` in crate Cargo.toml files.
- Environment variables prefixed `TERMINAL_*` for daemon config.
- WebSocket auth: first message must be `Auth { token }` within 10 seconds.
- Colocated tests: `#[cfg(test)] mod tests` in each module.
- New protocol variants must have serialization roundtrip tests.
- Pane components must register themselves with `registerPane(kind, Component)`.
- Mode definitions must register themselves with `registerMode(def)` (imported in `modes/definitions.ts`).

## Milestone Status

| Milestone | Issues | Status |
|-----------|--------|--------|
| M1 Foundation | #12, #15, #19, #24, #28 | ✅ Implemented (per-client active workspace landed via #99/#100/#101) |
| M2 Panes | #10, #11, #13, #18, #22 | ✅ Implemented |
| M3 Modes | #14, #16, #17 | ✅ Implemented |
| M4 Terminal | #20, #21, #23, #26, #27, #38 | ✅ Implemented (restore API + UI landed via #94/#95/#96) |
| M5 Git | #25, #29, #30, #36, #37 | ✅ Implemented (stash pop/apply/drop included) |
| M6 Browser | #31, #32 | ✅ Implemented |
| M7 Polish | #33, #34, #35 | ✅ Implemented |
| M11 Build tooling | — | ✅ `Makefile`, `run.sh`, `release.sh` |
| M14 Frontend tests | — | ✅ Vitest suite (stores, eventRouter, components) |
| M16 Runtime WS URL | — | ✅ Resolved via `resolveDaemonWsUrl` |

## Commit Messages

Format: `TERMINAL-XXX: <description>`. No co-author footer.
