# Naming Conventions

Canonical names for every layer of the platform. Other docs reference these rules.

## Files and directories

| Where | Convention | Example |
|-------|------------|---------|
| Frontend dirs | `kebab-case` | `frontend/src/panes/git-status/`, `frontend/src/core/services/` |
| React components | `PascalCase.tsx` | `AppChrome.tsx`, `GitStatusPane.tsx` |
| TS modules | `camelCase.ts` | `commandBus.ts`, `shortcutMap.ts` |
| Domain types file | `types.ts` under a domain folder | `frontend/src/domain/pane/types.ts` |
| Rust modules | `snake_case.rs` | `daemon_context.rs`, `git_engine.rs` |
| Rust dirs | `snake_case/` with `mod.rs` | `crates/terminal-daemon/src/dispatchers/mod.rs` |

Co-located tests use `.test.tsx` (frontend) or a `#[cfg(test)] mod tests` block at the bottom of the module (Rust).

## TypeScript type names

| Kind | Convention | Example |
|------|------------|---------|
| Interfaces / types | `PascalCase` | `ModeDefinition`, `PaneDefinition`, `WorkspaceStore` |
| Discriminated-union variants | `PascalCase` tag | `{ type: 'SET_CONNECTION_STATUS' }` |
| String-literal type values | `PascalCase` | `PaneKind = 'AiRun' \| 'Terminal' \| ...` |
| Enums and union members that mirror Rust enums | exact match to Rust variant | `WorkspaceMode = 'AiSession' \| 'Terminal' \| 'Git' \| 'Browser'` |
| React props interfaces | `<ComponentName>Props` | `PaneProps`, `PaneHeaderProps` |
| Hook names | `useXxx` | `useWebSocket`, `useBrowserNavigation` |
| Event action types | `UPPER_SNAKE_CASE` inside reducer tags | `'SET_SESSIONS'`, `'TOGGLE_COMMAND_PALETTE'` |

## Rust type names

Follow Rust convention:

| Kind | Convention | Example |
|------|------------|---------|
| Structs, enums, traits | `PascalCase` | `Workspace`, `PaneLayout`, `DaemonContext`, `MergeConflictFile` |
| Enum variants | `PascalCase` | `WorkspaceMode::AiSession`, `PaneKind::GitStatus` |
| Functions, methods, modules, fields | `snake_case` | `broadcast_workspace`, `workspace_channels`, `load_session` |
| Constants | `SCREAMING_SNAKE_CASE` | `DEFAULTS`, `MAX_OUTPUT_LINES` |
| Error types | `<Domain>Error` ending | `PersistenceError` |

## Protocol naming (wire format)

Protocol lives in `crates/terminal-core/src/protocol/v1.rs`. It is shared between Rust daemon and TypeScript frontend; names must match exactly on both sides.

| Kind | Convention | Example |
|------|------------|---------|
| Command variants (`AppCommand`) | `PascalCase` verb-first | `StartRun`, `CreateWorkspace`, `PushBranch`, `GetRepoStatus` |
| Event variants (`AppEvent`) | `PascalCase` noun- or past-tense | `WorkspaceCreated`, `RunStarted`, `OutputChunk`, `AuthSuccess` |
| Struct field names (in JSON) | `snake_case` | `workspace_id`, `last_active_at`, `linked_session_id` |
| Type tag (Serde) | `{ "type": "VariantName", ... }` | `#[serde(tag = "type")]` on enums |

Rule of thumb: commands are **what the client asks for**, events are **what the daemon reports happened**.

## IDs

| What | Format | Example |
|------|--------|---------|
| Workspace ID | UUID v4 | `workspace.id: Uuid` |
| Run ID | UUID v4 | `run.id: Uuid` |
| Session ID | UUID v4 | `session.id: Uuid` |
| Terminal session ID | UUID v4 | `TerminalSessionMeta.session_id` |
| Pane ID (frontend) | `<kind-lower>-<counter>-<ms>` or layout default | `terminal-3-1712341234567`, `git-status`, `ai-run` |
| Mode ID | Capitalized literal that matches `WorkspaceMode` | `'AiSession'`, `'Terminal'`, `'Git'`, `'Browser'` |

Mode IDs are **capitalized** (matching `WorkspaceMode` in Rust), not lowercase-kebab. If you see a doc or issue that says "lowercase-kebab," trust the code — it says `'AiSession'`.

## Shortcut IDs

Shortcuts are keyed in `frontend/src/core/shortcutMap.ts` as `domain:action`:

| Domain | Examples |
|--------|----------|
| `pane:` | `pane:split-right`, `pane:split-down`, `pane:close`, `pane:focus-next` |
| `layout:` | `layout:terminal`, `layout:ai`, `layout:git`, `layout:browser` |
| `sidebar:` | `sidebar:toggle`, `sidebar:explorer`, `sidebar:changes`, `sidebar:git` |
| `git:` | `git:refresh`, `git:push`, `git:pull`, `git:fetch` |
| `workspace:` | `workspace:list` |

New shortcut IDs must use `domain:kebab-action` and appear in `shortcutMap.ts`'s `DEFAULTS` object so they surface in the command palette.

## CSS variables

Design tokens live in `frontend/src/styles/tokens.css`. All platform CSS variables use the `--terminal-` prefix:

```css
--terminal-bg
--terminal-accent
--terminal-border
--terminal-pane-focus
```

Do not introduce undecorated variable names (`--bg`, `--accent`). Component-local variables may scope under a more specific prefix but must still begin with `--terminal-`.

## Commit messages

From `CLAUDE.md`:

```
TERMINAL-XXX: <description>
```

No co-author footer. Prefer one commit per logical step (not per file).

## Branch names

Feature branches follow `claude/<slug>` for Claude Code-driven work (see `claude/implement-open-issues-NLHzf`) or `TERMINAL-XXX/<slug>` for human work (see `TERMINAL-002/docker-all-in-one`).
