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
| `terminal-app` | Tauri desktop shell (future — currently scaffolded) |

### Key Design Decisions

- **Git worktree isolation**: Each AI run gets its own worktree (`.terminal-worktrees/{uuid}`). The user's main checkout is never touched during a run.
- **Pure CLI git**: All git operations go through `git` subprocess calls (async via `tokio::process::Command`). No libgit2 dependency.
- **JSON persistence**: Sessions, runs, and worktree metadata stored as atomic JSON files (`write .tmp` → `rename`). Daemon recovers gracefully from crashes.
- **Dirty working directory detection**: Before starting a run, the daemon checks for uncommitted changes and warns the user — since the worktree is created from HEAD, uncommitted work would be invisible to the AI.

## Prerequisites

- **Rust** 1.85+ (`rustup install stable`)
- **Node.js** 18+ with npm
- **Git** 2.20+
- **Docker** and **Docker Compose** (for running tests in isolated environment)

## Installation

```bash
# Clone
git clone https://github.com/lfrmonteiro99/terminal.git
cd terminal

# Build the daemon
cargo build -p terminal-daemon

# Install frontend dependencies
cd frontend
npm install
cd ..
```

## Running

### Start the daemon

```bash
cargo run -p terminal-daemon
```

The daemon:
1. Creates `~/.terminal-daemon/` for data (sessions, runs, worktree metadata)
2. Generates an auth token at `~/.terminal-daemon/auth_token`
3. Writes its port to `~/.terminal-daemon/port`
4. Listens on `127.0.0.1:3000` (default) for WebSocket connections

### Start the frontend dev server

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:5173`. Connect to the daemon by entering:
- **WebSocket URL**: `ws://127.0.0.1:3000/ws`
- **Auth token**: contents of `~/.terminal-daemon/auth_token`

### Using the app

1. Enter a project root path and click **Start Session**
2. Type a prompt and click **Run** — the daemon creates a git worktree and runs Claude in it
3. If your working directory has uncommitted changes, you'll see a warning modal with options to **Stash & Run**, **Run Anyway**, or **Cancel**
4. After the run completes, review the diff in the **PostRunSummary** panel
5. **Merge** the changes into your main branch or **Revert** to discard them
6. Browse git stashes from the sidebar's **Git > Stashes** section

## Running Tests

### Rust tests (via Docker — recommended)

```bash
docker compose run --rm dev cargo test -p terminal-core -p terminal-daemon
```

This uses `Dockerfile.dev` (Rust 1.85 + git) to ensure git is available for integration tests.

### Rust tests (local)

```bash
cargo test -p terminal-core -p terminal-daemon
```

Requires `git` on PATH.

### Frontend checks

```bash
cd frontend

# Type check
npx tsc --noEmit --skipLibCheck

# Production build
npm run build

# Lint
npm run lint
```

## Project Structure

```
terminal/
├── Cargo.toml                  # Workspace root
├── Dockerfile                  # Production build
├── Dockerfile.dev              # Dev/test image (with git)
├── docker-compose.yml          # Test runner
├── crates/
│   ├── terminal-core/          # Shared types + protocol
│   │   └── src/
│   │       ├── models.rs       # Session, Run, RunState, DiffStat, StashEntry, WorktreeMeta
│   │       ├── protocol/v1.rs  # AppCommand + AppEvent (serde tagged enums)
│   │       └── config.rs       # DaemonConfig
│   ├── terminal-daemon/        # Backend server
│   │   └── src/
│   │       ├── main.rs         # Entry point, wiring
│   │       ├── server.rs       # Axum WebSocket server
│   │       ├── dispatcher.rs   # Command handler, run lifecycle, git integration
│   │       ├── git_engine.rs   # Pure CLI git wrapper (24 async operations)
│   │       ├── persistence.rs  # JSON file CRUD, atomic writes, crash recovery
│   │       ├── claude_runner.rs# Claude subprocess management
│   │       └── parser.rs       # Claude output parser
│   └── terminal-app/           # Tauri shell (scaffolded)
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
- [ ] **Phase 3**: Resilience — Windows Job Objects, reconnect state rebuild, DiffViewer with syntax highlighting
- [ ] **Phase 4**: Memory + Polish — `.project-intelligence`, timeline/audit view, output virtualization
