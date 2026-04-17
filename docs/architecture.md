# Architecture

Terminal Engine is a Tauri v2 desktop app that manages AI coding sessions with
git-integrated worktree sandboxing, plus general-purpose terminal and git panes.
This document summarises the shipping architecture; see
[`bin-cc.md`](./bin-cc.md) for the optional `cc` CLI helper that is *separate*
from the app.

## Overview

```
frontend (React 19 + Vite)  ◄── WS ──►  terminal-daemon (Rust + Axum)
                                                │
                                                ├─ DaemonContext (shared state)
                                                ├─ Dispatcher + domain dispatchers
                                                ├─ PtyManager (terminal sessions)
                                                ├─ GitEngine (tokio::process)
                                                └─ Persistence (atomic JSON)

terminal-app (Tauri v2) embeds the daemon in-process → same WS protocol.
```

### Workspace crates

| Crate | Role |
|-------|------|
| `terminal-core` | Shared types, protocol (`AppCommand`/`AppEvent`), domain models (`Workspace`, `PaneLayout`, `WorkspaceMode`), `DaemonConfig`, `DaemonMode` |
| `terminal-daemon` | Library (`lib.rs`) + standalone binary (`main.rs`). Axum WS server, dispatchers, PTY manager, git engine, persistence |
| `terminal-app` | Tauri v2 native shell — embeds daemon via `terminal_daemon::start_server()` |

Frontend lives in `frontend/` (React 19 + TypeScript + Vite).

## Daemon

### Modes (`DaemonMode`)

- **Standalone** — CLI / Docker. Writes `~/.terminal-daemon/port` and
  `~/.terminal-daemon/auth_token` so a browser client can discover it.
- **Embedded** — Tauri. The daemon runs as a `tokio::spawn` task inside the
  app process; port + token live in memory only, no files on disk.

Both modes speak the same WebSocket protocol.

### Components

| Module | Purpose |
|--------|---------|
| `server.rs` | Axum WS server; auth handshake (first message must be `Auth { token }` within 10 s) |
| `dispatcher.rs` | Command router — dispatches to domain dispatchers |
| `daemon_context.rs` | Shared state: sessions, active runs, workspaces, PTY channels, persistence handles |
| `dispatchers/workspace_dispatcher.rs` | Workspace lifecycle (create/close/activate) |
| `dispatchers/git_dispatcher.rs` | Extended git ops (push/pull/fetch, merge conflicts) |
| `pty/manager.rs` | Real PTY via `openpty(2)`; resize via `ioctl(TIOCSWINSZ)` |
| `git_engine.rs` | Pure CLI git wrapper (`tokio::process::Command`); no libgit2 |
| `persistence.rs` | Atomic JSON writes (`.tmp` → `rename`); crash recovery on startup |
| `claude_runner.rs` | Claude subprocess runner with streaming output |

### Channels

- **`mpsc`** — client → dispatcher commands (per-connection reply channel).
- **`broadcast`** — dispatcher → clients events. Each workspace has its own
  `broadcast::Sender<String>` for event isolation (M1-05); otherwise falls back
  to the global channel.
- **`oneshot`** — shutdown signalling.

### Persistence

`~/.terminal-daemon/` subdirectories (standalone mode only):

```
sessions/   runs/   worktrees/   terminals/
```

Atomic writes guarantee no corrupt files on crash. The daemon re-hydrates
in-flight runs from disk on startup.

## Protocol

`terminal-core/src/protocol/v1.rs` defines two flat enums with
`#[serde(tag = "type")]`:

- `AppCommand` — client → daemon (auth, sessions, runs, workspaces, git, PTY).
- `AppEvent` — daemon → client (state transitions, output, errors, listings).

Every new variant needs a roundtrip serialization test in the same module.

## Frontend

### State layers (M1-02)

| Store | Scope |
|-------|-------|
| `state/app-store.ts` | Global: connection, sessions, workspaces |
| `state/workspace-store.ts` | Per-workspace: runs, output, sidebar, terminal sessions |

Both are plain reducers; the historical `context/AppContext.tsx` is wired in
production and mirrors a subset of the new stores until the migration lands.

### Service layer (M1-03)

- `core/commands/commandBus.ts` — decouples UI from raw WS payload construction.
- `core/events/eventRouter.ts` — routes every `AppEvent` variant to the correct
  store. TS `assertNever` in the default arm is the compile-time guarantee.
- `core/services/*.ts` — domain services (session, run, git, workspace,
  terminal) that call the command bus.
- `core/daemon/resolveDaemonWsUrl.ts` — runtime WS URL resolution. Precedence:
  Tauri-injected info > `window.__TERMINAL_CONFIG__` > same-origin `/ws`.

### Panes (M2)

`panes/registry.ts` maps `PaneKind` → React component. `PaneRenderer.tsx` walks
the recursive `PaneLayout` tree. Shipping kinds: `AiRun`, `Terminal`,
`GitStatus`, `GitHistory`, `FileExplorer`, `Browser`, `Diff`, `FileViewer`,
`Search`, `Empty`.

### Modes (M3)

`modes/registry.ts` holds `ModeDefinition`s registered by
`modes/definitions.ts` (AiSession / Terminal / Git / Browser).

## Data flow example

Starting a run:

1. User clicks **Run** in `AiRunPane` → `runService.start(prompt, mode)` →
   `commandBus.dispatch({ type: 'StartRun', … })`.
2. `useWebSocket.ts` sends the JSON payload over the open socket.
3. Daemon `Dispatcher` receives, routes to run handler, spawns the Claude
   subprocess inside a git worktree, streams stdout/stderr via
   `broadcast::Sender<String>`.
4. Each event lands back as `AppEvent` (`RunStateChanged`, `RunOutput`,
   `RunCompleted`, …).
5. `eventRouter.ts` dispatches the matching store action; panes re-render.

## Docker, Tauri, and `run.sh`

- `./run.sh` — development: `docker compose up` under the hood. Daemon on
  `:3000`, Vite dev server on `:5173`, WS proxied via `/ws`.
- `./release.sh` — production: builds a signed Tauri installer (`.deb` /
  `.AppImage` / `.dmg` / `.msi`).
- `make run` / `make desktop` / `make test` — convenience targets that wrap
  the scripts above.

See [`next-steps.md`](./next-steps.md) for the short getting-started.
