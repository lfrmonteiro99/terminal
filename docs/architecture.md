# Architecture

Terminal Engine is a desktop dev platform: a Rust daemon for durable state and heavy I/O, a TypeScript frontend for UI and layout, and a Tauri shell that embeds the daemon. This doc ties the pieces together.

Read after [panes.md](panes.md), [modes.md](modes.md), [workspaces.md](workspaces.md).

## Mental model

```
┌────────────────────────────── Tauri shell (terminal-app) ──────────────────────────────┐
│                                                                                         │
│   ┌──────────────── Rust daemon (terminal-daemon) ──────────────┐   ┌── Frontend ──┐   │
│   │                                                              │   │ (React/Vite) │   │
│   │   Axum WS ──► Dispatcher ──► DaemonContext                   │   │              │   │
│   │                  │           ├── sessions / runs            │   │  App.tsx     │   │
│   │                  ├──► WorkspaceDispatcher                   │   │   │          │   │
│   │                  ├──► GitDispatcher                         │   │   ├ AppChrome │   │
│   │                  └──► PtyManager                            │◄──┤   ├ Sidebar   │   │
│   │                                                              │ws │   └ PaneRend.│   │
│   │   Persistence (atomic JSON): sessions/ runs/                 │   │              │   │
│   │                              worktrees/ terminals/           │   │  State:      │   │
│   │                                                              │   │   app-store  │   │
│   │   ClaudeRunner (subprocess), GitEngine (git CLI)             │   │   ws-store   │   │
│   └──────────────────────────────────────────────────────────────┘   └──────────────┘   │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

The daemon owns durable state: workspaces, runs, sessions, PTY metadata, git operations. The frontend owns layout, focus, and presentation. They communicate only over a WebSocket, which enforces a clean separation.

## The three workspace crates

From root `Cargo.toml`:

| Crate | Role |
|-------|------|
| `terminal-core` | Shared types: protocol (`AppCommand` / `AppEvent`), domain models (`Workspace`, `PaneLayout`, `WorkspaceMode`), `DaemonConfig`, `DaemonMode`. No I/O. |
| `terminal-daemon` | Library (`lib.rs`) + standalone binary (`main.rs`). Axum WS server, dispatchers, `PtyManager`, git engine, persistence. |
| `terminal-app` | Tauri v2 native shell. Embeds the daemon in-process via `terminal_daemon::start_server()`. |

Frontend lives under `frontend/` — React 19 + TypeScript + Vite. It is bundled into `terminal-app` for the native build and also serves standalone for the dockerized web path.

## Daemon

### Dispatcher pattern

`crates/terminal-daemon/src/dispatcher.rs` is a thin router. It owns no state; it holds a reference to `DaemonContext` and delegates commands to domain-specific dispatchers under `dispatchers/`:

- `dispatchers/workspace_dispatcher.rs` — `CreateWorkspace`, `CloseWorkspace`, `ActivateWorkspace`, `ListWorkspaces`.
- `dispatchers/git_dispatcher.rs` — extended git ops: `PushBranch`, `PullBranch`, `FetchRemote`, `GetMergeConflicts`, `ResolveConflict`.

Run and session lifecycle live in the main dispatcher for now (they predate the split). If you're adding a new command for an existing domain, add it to that dispatcher; if you're introducing a new domain (e.g. tasks, notifications), add a new file under `dispatchers/`.

### `DaemonContext`

`crates/terminal-daemon/src/daemon_context.rs` is the shared state handle passed to every dispatcher. Fields (`daemon_context.rs:24-39`):

- `config: DaemonConfig`
- `event_tx: broadcast::Sender<String>` — global event channel
- `persistence: Arc<Persistence>` — atomic JSON writer
- `sessions: Arc<Mutex<HashMap<Uuid, Session>>>`
- `active_runs: Arc<Mutex<HashMap<Uuid, ActiveRun>>>`
- `concurrency: Arc<Mutex<HashMap<PathBuf, Uuid>>>` — one run per project root
- `runner: Arc<ClaudeRunner>`
- `workspaces: Arc<Mutex<HashMap<Uuid, Workspace>>>`
- `active_workspace_id: Arc<Mutex<Option<Uuid>>>`
- `workspace_channels: Arc<Mutex<HashMap<Uuid, broadcast::Sender<String>>>>`

Two channels exist: the global `event_tx` for lifecycle events, and per-workspace channels for workspace-scoped output (runs, PTY, git refreshes). `broadcast_workspace(workspace_id, event)` writes to the right one with a fallback to global. See [workspaces.md](workspaces.md#workspace-scoped-event-routing-m1-05).

### Runtime modes

`DaemonMode` (in `terminal-core::config`):

- `Standalone` — writes port and token to `~/.terminal-daemon/` on start. Used by CLI, Docker, and the legacy web build. Persists workspaces and runs to disk.
- `Embedded` — in-memory only; no file writes. Used by the Tauri app so uninstall leaves no state behind.

### PTY

`crates/terminal-daemon/src/pty/manager.rs` owns terminal sessions. The current implementation uses `openpty` for real PTY allocation (commit `936cc4c`). Each session has a workspace id, a pane id, a shell path, and a cwd — persisted into `TerminalSessionMeta` under `terminals/` so M4-06 can offer restore on daemon restart (see [workspaces.md](workspaces.md#crash-recovery)).

### Git

Pure CLI via `tokio::process::Command`. No libgit2. Rationale: simpler builds, exact git behavior, easier to debug. Basic ops (status, stage, commit, checkout) live in `git_engine.rs`. Extended ops (push/pull/fetch/conflicts) live in `dispatchers/git_dispatcher.rs`.

## Frontend

### State layers

Two top-level stores, imported from `frontend/src/state/`:

- `app-store.ts` — global, cross-workspace state. Connection status, session list, workspace list, active workspace id, command-palette open flag.
- `workspace-store.ts` — per-workspace state. AI run state, output lines, runs list, selected run, sidebar view, git snapshots, merge conflicts, terminal session summaries, diff panel.

Rule: if two active workspaces need different values, it belongs in `WorkspaceStore`. Otherwise, `AppStore`.

### Service layer

`frontend/src/core/`:

- `commands/commandBus.ts` — UI code calls `commandBus.send(...)`; never touches the WebSocket directly.
- `events/eventRouter.ts` — incoming daemon events are routed to the app store or the correct workspace store.
- `services/*.ts` — domain verbs: `sessionService`, `runService`, `gitService`, `workspaceService`, `terminalService`, `contextSwitchService`. Each exposes a small API that composes commandBus calls.

This layer is what shields UI code from protocol churn. If you're adding a feature, put the wire logic in a service and expose a hook or callback to the component.

### Three registries

The frontend has exactly three runtime registries. Everything else composes through them.

| Registry                               | Key             | Value                | Populated by                          |
|----------------------------------------|------------------|----------------------|----------------------------------------|
| `frontend/src/panes/registry.ts`       | `PaneKind`      | React component       | side-effect imports in `App.tsx:29-37` |
| `frontend/src/modes/registry.ts`       | `WorkspaceMode` | `ModeDefinition`     | `frontend/src/modes/definitions.ts`    |
| `frontend/src/core/keybindings.ts`     | `id: string`    | `KeyBinding`          | feature-local `registerBinding` calls  |

There is no "layout registry" — layouts are values (`PaneLayout`), not registered kinds.

### Rendering path

`App.tsx` wires providers and renders top-level chrome. The main pane area is `PaneRenderer` (`frontend/src/panes/PaneRenderer.tsx`):

1. Receives the active workspace's `PaneLayout`.
2. Walks the tree, computes absolute positions for every `Single` leaf.
3. For each leaf, looks up the component in the pane registry and renders it.
4. Draws split-seam drag handles between pairs of children.

Panes themselves are "dumb" renderers — they read from the workspace store and render their data. Commands go through services, not directly into the pane.

## Protocol

`crates/terminal-core/src/protocol/v1.rs` defines two flat enums, both tagged with `#[serde(tag = "type")]`:

- `AppCommand` — what the client asks for (e.g. `StartRun`, `CreateWorkspace`, `CreateTerminalSession`, `PushBranch`).
- `AppEvent` — what the daemon reports (e.g. `RunStarted`, `WorkspaceCreated`, `OutputChunk`, `AuthSuccess`).

Every new variant ships with a roundtrip test in the same file's `#[cfg(test)] mod tests` block.

First WS message after connect must be `Auth { token }` within 10 s, otherwise the daemon drops the connection.

## Mode vs pane vs feature

Decision framework for where to put new work:

- **Mode** — if it deserves its own launch shortcut and a distinctive default layout. Examples: Git, Terminal, Browser.
- **Pane** — if it's a self-contained UI surface that displays or edits one kind of thing. Examples: `GitStatusPane`, `TerminalPane`, `BrowserPane`, `FileViewerPane`, `MergeConflictPane`.
- **Feature** — everything else: syntax highlighting inside an existing pane, a new shortcut, a new git command, a new command-palette entry, a theme. Features live close to the pane or service they extend, not in their own directory at the top of `panes/`.

Examples:

- A diff viewer is a **pane**. A keyboard shortcut for "next hunk" inside it is a **feature**.
- Ripgrep search is a **pane**. "Search current repo" from the command palette is a **feature** that opens the search pane.
- SSH terminals are not a mode — they are a **feature** of the Terminal pane. The SSH-specific chrome lives in `SshConnectDialog.tsx`.

## Testing & building

From `CLAUDE.md`: build Rust inside Docker, build frontend on host.

```bash
docker compose run --rm test
docker compose run --rm test cargo check -p terminal-app
cd frontend && npm run build
```

MSRV is Rust 1.88 (required by the `time` crate). Dockerfiles pin `rust:1.88-slim`.

## Related

- [panes.md](panes.md)
- [modes.md](modes.md)
- [workspaces.md](workspaces.md)
- [keybindings.md](keybindings.md)
- [ux-conventions.md](ux-conventions.md)
- [naming-conventions.md](naming-conventions.md)
