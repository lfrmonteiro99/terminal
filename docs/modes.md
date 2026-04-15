# Modes

A mode is a named workspace preset: icon, label, default pane layout, and a launch shortcut. Modes never change behavior at runtime — they only decide the starting layout. After creation, a workspace is freely rearrangeable.

See [naming-conventions.md](naming-conventions.md) and [panes.md](panes.md) first.

## `ModeDefinition`

`frontend/src/modes/types.ts`:

```ts
export interface ModeDefinition {
  id: WorkspaceMode;              // 'AiSession' | 'Terminal' | 'Git' | 'Browser'
  label: string;                  // Human-readable display name
  icon: string;                   // Single emoji or glyph (e.g. '🤖', '>_', '⎇', '◎')
  description: string;            // One-sentence description, surfaces in mode picker
  defaultLayout: () => PaneLayout; // Fresh layout each time (function, not value)
  shortcut?: string;              // Optional keybinding to create a workspace in this mode
}
```

Every field must be populated — none are optional except `shortcut`.

### Field semantics

- **`id`** — must match the `WorkspaceMode` enum in `crates/terminal-core/src/models.rs:8-15`. Adding a new mode requires a Rust change first (see checklist below).
- **`label`** — shown in the workspace switcher and mode picker. Keep under 16 characters.
- **`icon`** — single visual character. Do **not** use multi-character sequences or SVG strings. `tokens.css` does not currently ship SVG inline helpers.
- **`description`** — one sentence, no trailing period, used for mode-picker tooltips.
- **`defaultLayout`** — **a function** that returns a fresh `PaneLayout` on every call. Returning a shared literal will share references across workspaces and cause weird state bleed. Always call fresh.
- **`shortcut`** — human-readable combo like `'Ctrl+1'`. Resolved through the keybinding layer (see [keybindings.md](keybindings.md)).

## Registry

`frontend/src/modes/registry.ts`:

```ts
export function registerMode(def: ModeDefinition): void;
export function getMode(id: WorkspaceMode): ModeDefinition | null;
export function listModes(): ModeDefinition[];
```

Modes are registered by importing `frontend/src/modes/definitions.ts`, which runs `registerMode(...)` for every built-in mode at import time. `frontend/src/App.tsx:38` imports this module for side effects.

## Built-in modes

From `frontend/src/modes/definitions.ts`:

| id          | icon | shortcut   | default layout |
|-------------|------|-----------|----------------|
| `AiSession` | 🤖   | `Ctrl+1` | `Single(AiRun)` |
| `Terminal`  | `>_` | `Ctrl+2` | `Single(Terminal)` |
| `Git`       | `⎇`  | `Ctrl+3` | `Split(Horizontal, 0.4, GitStatus, GitHistory)` |
| `Browser`   | `◎`  | `Ctrl+4` | `Single(Browser)` |

## Creating a workspace in a mode

`frontend/src/core/services/workspaceService.ts` ultimately sends `AppCommand::CreateWorkspace { name, root_path, mode }` to the daemon. The daemon calls the corresponding `PaneLayout::default_<mode>()` helper (e.g. `default_git()`, `crates/terminal-core/src/models.rs:111-126`) to fill in the initial layout before persisting the workspace.

The frontend and backend both carry a default-layout function per mode. They must agree: if you change the frontend `defaultLayout()`, update the Rust `default_<mode>()` too.

## Switching modes on an existing workspace

`frontend/src/core/services/contextSwitchService.ts` exposes `switchMode(workspaceId, targetMode)`. It:

1. Preserves `root_path` and `linked_session_id`.
2. Calls the target mode's `defaultLayout()` to build a fresh layout.
3. Dispatches a workspace update that replaces the mode and layout.

Switching does **not** migrate pane contents. If the user had three terminals open and switches to Git mode, the terminals are discarded. Prompt before switching in destructive cases.

## Adding a new mode

1. **Rust enum** — add the variant to `WorkspaceMode` in `crates/terminal-core/src/models.rs`. Update the `workspace_mode_all_variants_serialize` test.
2. **Rust default layout** — add `PaneLayout::default_<mode>()` to the same file, alongside the existing `default_ai_session` / `default_terminal` / `default_git` helpers.
3. **Frontend `WorkspaceMode` union** — add the literal to `frontend/src/domain/workspace/types.ts`.
4. **`ModeDefinition`** — add a `registerMode({ id, label, icon, description, defaultLayout, shortcut })` block to `frontend/src/modes/definitions.ts`. The `defaultLayout` must return the same structure as the Rust `default_<mode>()`.
5. **Shortcut** — pick a free `Ctrl+N` (or other combo). Check `frontend/src/core/shortcutMap.ts` for collisions. See [keybindings.md](keybindings.md).
6. **Mode picker copy** — double-check the description renders sensibly in `WorkspaceSwitcher.tsx` (the picker uses `listModes()` directly, so adding the entry is enough).
7. **Protocol roundtrip test** — add a serialization test for the new `WorkspaceMode` variant in `crates/terminal-core/src/protocol/v1.rs`.

No frontend registry file needs editing — `definitions.ts` is the single mode registration point.

## Anti-patterns

- **Do not branch on mode in panes.** A pane should render the same regardless of which mode the containing workspace is in. Modes are layout presets, not behavioral switches.
- **Do not persist a mode's layout shape separately from the workspace.** The layout lives in `Workspace.layout`; the mode id is just metadata for the chrome badge and future "re-open in this mode" operations.
- **Do not add mode-specific CSS classes** (`.mode-git`, `.mode-terminal`). Style panes by kind, not by mode.

## Related

- [panes.md](panes.md) — the pane kinds available for `defaultLayout`
- [workspaces.md](workspaces.md) — how modes surface at workspace creation
- [architecture.md](architecture.md) — the three-registry pattern (modes, panes, layouts)
