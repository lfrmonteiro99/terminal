# Terminal Engine — Project Instructions

## Workspace

Three crates in `crates/`:

| Crate | Role |
|-------|------|
| `terminal-core` | Shared types, protocol (`AppCommand`/`AppEvent`), `DaemonConfig`, `DaemonMode` |
| `terminal-daemon` | Library (`lib.rs`) + standalone binary (`main.rs`). Axum WS server, dispatcher, git engine, persistence |
| `terminal-app` | Tauri v2 native shell. Embeds daemon in-process via `terminal_daemon::start_server()` |

Frontend: `frontend/` — React 19 + TypeScript + Vite.

## Building & Testing

**Always use Docker for Rust builds** (Windows host lacks native toolchain setup):

```bash
docker compose run --rm test                          # 63 Rust tests
docker compose run --rm test cargo check -p terminal-app  # Tauri crate check
```

Frontend builds run on host:
```bash
cd frontend && npm run build
```

Rust MSRV: **1.88** (required by `time` crate). Dockerfiles use `rust:1.88-slim`.

## Key Patterns

- **DaemonMode::Standalone** — writes port/token to `~/.terminal-daemon/`. Used by CLI/Docker.
- **DaemonMode::Embedded** — in-memory only, no file writes. Used by Tauri app.
- **Channels**: `mpsc` for commands (client→dispatcher), `broadcast` for events (dispatcher→clients), `oneshot` for shutdown.
- **Git operations**: Pure CLI via `tokio::process::Command`. No libgit2.
- **Persistence**: Atomic JSON writes (`.tmp` → rename). Crash recovery on startup.
- **Error handling**: `Result<T, Box<dyn Error + Send + Sync>>` at boundaries. `thiserror` for typed errors. No `unwrap()` in `start_server()`.

## Conventions

- Workspace dependencies in root `Cargo.toml` — use `dep.workspace = true` in crate Cargo.toml files.
- Environment variables prefixed `TERMINAL_*` for daemon config.
- WebSocket auth: first message must be `Auth { token }` within 10 seconds.
- Colocated tests: `#[cfg(test)] mod tests` in each module.

## Commit Messages

Format: `TERMINAL-XXX: <description>`. No co-author footer.
