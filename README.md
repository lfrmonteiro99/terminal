# Terminal Engine

A desktop application for managing AI coding sessions with git-integrated sandboxing. Each AI run executes in an isolated git worktree, keeping the user's working directory untouched. Sessions, runs, and worktree metadata are persisted to disk with atomic writes and crash recovery.

## Architecture

```
┌─────────────────┐     WebSocket      ┌────────────────────┐
│    Frontend      │ ◄────────────────► │  terminal-daemon   │
│  React 19 + TS   │   JSON protocol   │  Axum + Tokio      │
│  Vite dev server │                    │                    │
└─────────────────┘                    ├────────────────────┤
                                       │  Dispatcher        │
┌─────────────────┐                    │  ├─ GitEngine      │
│  terminal-app   │                    │  ├─ Persistence    │
│  Tauri shell    │                    │  ├─ ClaudeRunner   │
│  (future)       │                    │  └─ Parser         │
└─────────────────┘                    └────────────────────┘
                                              │
┌──────────────────────────────────────────────┘
│  terminal-core (shared types)
│  ├─ models.rs    — Session, Run, RunState, DiffStat, StashEntry, etc.
│  ├─ protocol/v1  — AppCommand / AppEvent tagged enums
│  └─ config.rs    — DaemonConfig
└──────────────────────────────────────────────
```

### Crates

| Crate | Purpose |
|-------|---------|
| `terminal-core` | Shared types, protocol definitions, config |
| `terminal-daemon` | WebSocket server, dispatcher, git engine, persistence, Claude subprocess runner |
| `terminal-app` | Tauri v2 native desktop shell — embeds daemon in-process, auto-connects frontend |

### Key Design Decisions

- **Git worktree isolation**: Each AI run gets its own worktree (`.terminal-worktrees/{uuid}`). The user's main checkout is never touched during a run.
- **Pure CLI git**: All git operations go through `git` subprocess calls (async via `tokio::process::Command`). No libgit2 dependency.
- **JSON persistence**: Sessions, runs, and worktree metadata stored as atomic JSON files (`write .tmp` → `rename`). Daemon recovers gracefully from crashes.
- **Dirty working directory detection**: Before starting a run, the daemon checks for uncommitted changes and warns the user — since the worktree is created from HEAD, uncommitted work would be invisible to the AI.

## Quick Start (Docker)

The only prerequisite is **Docker** with **Docker Compose**.

```bash
git clone https://github.com/lfrmonteiro99/terminal.git
cd terminal
docker compose up
```

That's it. This starts:
- **Daemon** at `http://localhost:3000` (Rust binary + git)
- **Frontend** at `http://localhost:5173` (Vite dev server, proxies WebSocket to daemon)

Open `http://localhost:5173` in your browser. The frontend auto-connects to the daemon via the `/ws` proxy — no manual URL or token entry needed when using Docker.

### Using the app

1. Enter a project root path and click **Start Session**
2. Type a prompt and click **Run** — the daemon creates a git worktree and runs Claude in it
3. If your working directory has uncommitted changes, you'll see a warning modal with options to **Stash & Run**, **Run Anyway**, or **Cancel**
4. After the run completes, review the diff in the **PostRunSummary** panel
5. **Merge** the changes into your main branch or **Revert** to discard them
6. Browse git stashes from the sidebar's **Git > Stashes** section

### Stop

```bash
docker compose down
```

### Reset data

```bash
docker compose down -v
```

## Native Desktop App (Tauri)

The Tauri app bundles the daemon in-process — double-click the `.exe` and you're running. No Docker, no manual WebSocket URLs, no token files.

### Prerequisites

- **Rust** 1.88+
- **Node.js** 18+ with npm
- **Tauri CLI**: `cargo install tauri-cli --version "^2"`
- **WebView2** (Windows — bundled by the installer on first run)

### Development

```bash
cd crates/terminal-app
cargo tauri dev
```

This starts the Vite dev server and the Tauri window simultaneously. The embedded daemon starts on a random port, and the frontend auto-discovers it via `invoke('get_daemon_info')`.

### Build

```bash
cd crates/terminal-app
cargo tauri build
```

Produces `.exe` and `.msi` in `target/release/bundle/`.

### How It Works

- **DaemonMode::Embedded**: The daemon starts as a `tokio::spawn` task inside the Tauri process. Port/token are held in memory only — no files written to disk.
- **Auto-connect**: The frontend detects Tauri via `__TAURI_INTERNALS__`, polls `get_daemon_info` with exponential backoff until the daemon is ready, then connects the WebSocket automatically.
- **Single instance**: `tauri-plugin-single-instance` prevents multiple windows. Launching again focuses the existing window.
- **Clean shutdown**: `RunEvent::Exit` sends a shutdown signal via `oneshot` channel. No orphaned processes.

## Running Tests

```bash
docker compose run --rm --profile test test
```

Runs 63 Rust tests (32 core + 31 daemon) in an isolated container with git.

### Frontend checks (inside container)

```bash
docker compose run --rm frontend npx tsc --noEmit --skipLibCheck
docker compose run --rm frontend npm run build
```

## Local Development (without Docker)

If you prefer running natively:

### Prerequisites

- **Rust** 1.88+ (`rustup install stable`)
- **Node.js** 18+ with npm
- **Git** 2.20+

### Installation

```bash
cargo build -p terminal-daemon
cd frontend && npm install && cd ..
```

### Running

```bash
# Terminal 1: daemon
cargo run -p terminal-daemon

# Terminal 2: frontend
cd frontend && npm run dev
```

The daemon creates `~/.terminal-daemon/` for data, generates an auth token at `~/.terminal-daemon/auth_token`, and listens on a random port (written to `~/.terminal-daemon/port`).

Open `http://localhost:5173` and enter:
- **WebSocket URL**: `ws://127.0.0.1:<port>/ws` (check `~/.terminal-daemon/port`)
- **Auth token**: contents of `~/.terminal-daemon/auth_token`

### Local tests

```bash
cargo test -p terminal-core -p terminal-daemon  # requires git on PATH
cd frontend && npx tsc --noEmit --skipLibCheck && npm run build
```

## Project Structure

```
terminal/
├── Cargo.toml                  # Workspace root
├── Dockerfile                  # Daemon: multi-stage build → slim runtime with git
├── Dockerfile.dev              # Dev/test image (Rust + git, for running tests)
├── docker-compose.yml          # Full stack: daemon + frontend + test runner
├── .dockerignore               # Excludes target/, node_modules/, .git/
├── crates/
│   ├── terminal-core/          # Shared types + protocol
│   │   └── src/
│   │       ├── models.rs       # Session, Run, RunState, DiffStat, StashEntry, WorktreeMeta
│   │       ├── protocol/v1.rs  # AppCommand + AppEvent (serde tagged enums)
│   │       └── config.rs       # DaemonConfig, DaemonMode (Standalone/Embedded)
│   ├── terminal-daemon/        # Backend server
│   │   └── src/
│   │       ├── lib.rs          # Library entry: start_server(), DaemonHandle
│   │       ├── main.rs         # Standalone CLI entry point
│   │       ├── server.rs       # Axum WebSocket server
│   │       ├── dispatcher.rs   # Command handler, run lifecycle, git integration
│   │       ├── git_engine.rs   # Pure CLI git wrapper (24 async operations)
│   │       ├── persistence.rs  # JSON file CRUD, atomic writes, crash recovery
│   │       ├── claude_runner.rs# Claude subprocess management
│   │       └── parser.rs       # Claude output parser
│   └── terminal-app/           # Tauri v2 native shell (embeds daemon)
└── frontend/
    └── src/
        ├── App.tsx             # Main layout, event handlers
        ├── context/AppContext.tsx # useReducer state management
        ├── types/protocol.ts   # TypeScript mirrors of Rust protocol types
        ├── hooks/useWebSocket.ts
        └── components/
            ├── RunPanel.tsx           # Live run output display
            ├── DecisionPanel.tsx      # Blocking question handler
            ├── SessionSidebar.tsx     # Sessions/runs list + git section
            ├── PostRunSummary.tsx     # Diff stats, merge/revert actions
            ├── DirtyWarningModal.tsx  # Uncommitted changes warning
            └── StashDrawer.tsx        # Git stash browser
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUST_LOG` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `TERMINAL_HOST` | `127.0.0.1` | Daemon bind address |
| `TERMINAL_PORT` | `3000` | Daemon port |

## Protocol

The daemon communicates via WebSocket using JSON-serialized tagged enums.

**Commands** (client → daemon): `Auth`, `StartSession`, `EndSession`, `StartRun`, `CancelRun`, `GetDiff`, `MergeRun`, `RevertRun`, `ListStashes`, `GetStashFiles`, `GetStashDiff`, `CheckDirtyState`, `StashAndRun`, ...

**Events** (daemon → client): `AuthSuccess`, `RunStateChanged`, `RunOutput`, `RunCompleted`, `RunDiff`, `RunMerged`, `RunReverted`, `DirtyWarning`, `StashList`, `StashFiles`, `StashDiff`, ...

See `crates/terminal-core/src/protocol/v1.rs` for the complete protocol definition.

## Roadmap

- [x] **Phase 1**: Daemon skeleton — WebSocket server, session/run lifecycle, subprocess runner, parser, dispatcher, React frontend
- [x] **Phase 2**: Git sandbox — worktree isolation, persistence, crash recovery, merge/revert, SessionSidebar, PostRunSummary
- [x] **Phase 2.1**: Stash viewer, dirty working directory detection + warning modal
- [x] **Phase 2.2**: Native Tauri app — embedded daemon, auto-connect frontend, single-instance, clean shutdown
- [ ] **Phase 3**: Resilience — Windows Job Objects, reconnect state rebuild, DiffViewer with syntax highlighting
- [ ] **Phase 4**: Memory + Polish — `.project-intelligence`, timeline/audit view, output virtualization
