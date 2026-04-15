# Workspaces

A workspace binds a project root directory to a mode, a pane layout, and an optional AI session. It is the top-level unit of user work.

See [modes.md](modes.md) and [panes.md](panes.md) first.

## Domain type

`crates/terminal-core/src/models.rs:17-28`:

```rust
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub root_path: PathBuf,
    pub mode: WorkspaceMode,
    pub layout: PaneLayout,
    pub linked_session_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub last_active_at: DateTime<Utc>,
}
```

`WorkspaceSummary` (same file, `:31-52`) is the wire-friendly projection — same fields minus `layout` and `created_at`. `WorkspaceSummary` is what goes over the wire in list views; the full `Workspace` is fetched only when one is activated.

## Lifecycle

```
list → create → activate → (use / rearrange) → persist
                    ↓                          ↓
                  close ←──────────────────── restore (on daemon start)
```

### Create

Frontend sends `AppCommand::CreateWorkspace { name, root_path, mode }` (`crates/terminal-core/src/protocol/v1.rs:107-111`). The daemon:

1. Generates a UUID v4.
2. Calls `PaneLayout::default_<mode>()` to fill the layout.
3. Writes the workspace to persistence atomically.
4. Registers a workspace-scoped broadcast channel in `DaemonContext.workspace_channels`.
5. Broadcasts `AppEvent::WorkspaceCreated { workspace }` on the global channel.

### Activate

`AppCommand::ActivateWorkspace { workspace_id }` marks a workspace as active for the current client. Today this is stored globally in `DaemonContext.active_workspace_id` (single-client simplification; see `crates/terminal-daemon/src/daemon_context.rs:36`). Future multi-client support will scope this per connection.

Activation triggers `AppEvent::WorkspaceActivated { workspace_id }`.

### Use / rearrange

Panes, runs, git operations, and terminal sessions operate inside the active workspace. Every command that belongs to a workspace carries a `workspace_id` field. See `crates/terminal-core/src/protocol/v1.rs` for the full list — `StartRun`, `CreateTerminalSession`, `GetRepoStatus`, etc.

### Close

`AppCommand::CloseWorkspace { workspace_id }` removes the workspace from memory and disk. The daemon tears down its broadcast channel and emits `WorkspaceClosed`. Any child resources (runs, terminal sessions) owned by the workspace are stopped first.

## Persistence model

Workspaces persist to the daemon data dir (see `DaemonMode::Standalone` at `~/.terminal-daemon/`). `crates/terminal-daemon/src/persistence.rs:36-42` creates the following subdirs on startup:

- `sessions/` — AI sessions
- `runs/` — per-run artifacts
- `worktrees/` — sandbox worktree metadata
- `terminals/` — `TerminalSessionMeta` for M4-06 restore

Workspaces are persisted under the same base dir (one JSON per workspace). Writes go through `Persistence::atomic_write`:

```rust
fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, data)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}
```

Rule: **every write is atomic** (temp file + rename). Never write in place.

### What is saved

Field by field:

- `id`, `name`, `root_path`, `mode`, `created_at` — on create, never rewritten.
- `layout` — rewritten every time the user splits, closes, resizes, or renames a pane.
- `linked_session_id` — rewritten when the user links/unlinks an AI session.
- `last_active_at` — updated on activation and on significant interactions.

Layout writes are debounced client-side — the frontend updates its in-memory store immediately but batches the persistence command (typically ~300 ms) to avoid hammering disk on drag-resize.

### What is not saved

- Pane-local UI state (scroll, input drafts, selection).
- Terminal output scrollback (PTY output streams, not persisted; reconnect rebuilds from the live shell).
- Run output (lives in `runs/<id>/output` files, not the workspace JSON).

## Crash recovery

`DaemonMode::Standalone` writes port and token to `~/.terminal-daemon/` on start. On restart the daemon:

1. Re-reads every `*.json` under the workspace dir, deserializes into `Workspace`.
2. Re-creates the per-workspace `broadcast::Sender<String>` in `DaemonContext.workspace_channels`.
3. Walks `terminals/` and emits `RestorableTerminalSessions` — the frontend offers to spawn fresh shells in the same cwd (see `crates/terminal-core/src/models.rs:394-399`, `RestorableTerminalSession`).
4. Walks `runs/` and marks any run still in an active state as `Failed { phase: FailPhase::Cleanup }` (daemon does not resume runs across restart).

`DaemonMode::Embedded` (Tauri app, `terminal_app` crate) uses in-memory-only state — no file writes. Restart means starting from scratch.

## Workspace-scoped event routing (M1-05)

`DaemonContext.workspace_channels` holds a `broadcast::Sender<String>` per workspace. Events that concern a single workspace (run progress, PTY output, git refresh) go through that workspace's channel via `DaemonContext::broadcast_workspace(workspace_id, event)` (`daemon_context.rs:68-80`). If no channel is registered, the event falls back to the global `event_tx`.

Global events (auth, connection heartbeat, workspace list) always use the global channel.

Clients authenticate once and then subscribe to both the global channel and each workspace channel they activate.

## Cross-mode context transfer

`frontend/src/core/services/contextSwitchService.ts` exposes `switchMode(workspaceId, targetMode)`:

- Keeps `root_path` and `linked_session_id` on the existing workspace.
- Replaces `mode` and `layout` with the target mode's `defaultLayout()`.
- Persists the update and re-renders.

For "open the same context in a new workspace" (e.g. spin up a Terminal mode window on the same repo) the service spawns a new workspace with the same `root_path` and a different mode, so both workspaces coexist.

## Adding workspace-related state

Global (app-wide): add to `AppStore` in `frontend/src/state/app-store.ts`. Example: connection status, command palette open flag.

Per-workspace: add to `WorkspaceStore` in `frontend/src/state/workspace-store.ts`. Example: sidebar view, open diff panel, merge conflicts.

If the state belongs on disk across restarts, plumb it through `Workspace` (Rust model) and a new protocol command/event pair. Don't put persistence-worthy data in `WorkspaceStore` only — it dies with the tab.

## Related

- [architecture.md](architecture.md) — how workspaces sit between the daemon and the pane tree
- [panes.md](panes.md) — what `layout` points at
- [modes.md](modes.md) — where the initial layout comes from
