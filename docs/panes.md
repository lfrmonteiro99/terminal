# Panes

A pane is a single rectangular UI surface inside a workspace (a terminal, a git status view, a browser, etc.). Panes compose into a tree through splits.

See [naming-conventions.md](naming-conventions.md) for file and type naming rules.

## Domain types

Pane types are mirrored between Rust and TypeScript.

**Rust** (`crates/terminal-core/src/models.rs:54-92`):

```rust
pub enum PaneKind { AiRun, Terminal, GitStatus, GitHistory, FileExplorer, Browser, Diff }

pub struct PaneDefinition {
    pub id: String,
    pub kind: PaneKind,
    pub resource_id: Option<Uuid>,
}

pub enum PaneLayout {
    Single(PaneDefinition),
    Split { direction: SplitDirection, ratio: f32, first: Box<PaneLayout>, second: Box<PaneLayout> },
}
```

**TypeScript** (`frontend/src/domain/pane/types.ts`):

```ts
export type PaneKind =
  | 'AiRun' | 'Terminal' | 'GitStatus' | 'GitHistory'
  | 'FileExplorer' | 'Browser' | 'Diff'
  | 'FileViewer' | 'Search' | 'Empty';

export interface PaneDefinition {
  id: string;
  kind: PaneKind;
  resource_id: string | null;
  label?: string;
}

export type PaneLayout =
  | { Single: PaneDefinition }
  | { Split: { direction: SplitDirection; ratio: number; first: PaneLayout; second: PaneLayout } };
```

The TypeScript union includes extra frontend-only kinds (`FileViewer`, `Search`, `Empty`). These render without a Rust-side resource handle.

## Pane registry

`frontend/src/panes/registry.ts` is the single source of truth for kind → component mapping:

```ts
export function registerPane(kind: PaneKind, component: PaneComponent): void;
export function getPane(kind: PaneKind): PaneComponent | null;
```

Each pane module calls `registerPane` at import time. `frontend/src/App.tsx:29-37` imports every pane module for side effects:

```ts
import './panes/terminal/TerminalPane';
import './panes/ai-run/AiRunPane';
import './panes/git/GitStatusPane';
// ...
```

Registration failure is silent — forget the side-effect import and `PaneRenderer` will render a placeholder for that kind.

## Pane props

`frontend/src/panes/registry.ts`:

```ts
export interface PaneProps {
  pane: PaneDefinition;
  workspaceId: string;
  focused: boolean;
}
```

The renderer passes these three props. Panes pull their own state from the workspace store via hooks.

## Lifecycle

1. **Mount** — `PaneRenderer` walks the workspace layout tree, instantiates the component from the registry, passes `pane`/`workspaceId`/`focused`.
2. **State subscription** — the pane subscribes to its slice of `WorkspaceStore` (see [workspaces.md](workspaces.md)) via hooks.
3. **Render** — the pane draws inside a fixed-size wrapper positioned absolutely by `PaneRenderer`. No layout calculation belongs inside the pane.
4. **Serialize** — panes are persisted as `PaneDefinition` only: `{ id, kind, resource_id, label? }`. Transient scroll position, input text, selection, etc. are **not** persisted.
5. **Hydrate** — on restore, the pane mounts with the same `id` and `resource_id`. The pane re-attaches to daemon resources (PTY session, run, etc.) via `resource_id`.
6. **Unmount** — on pane close, the pane's `useEffect` cleanup runs. If the pane owns a daemon resource, it **must** send the corresponding close command (e.g. `CloseTerminalSession`).

## State ownership

Three tiers, in order of precedence:

| Tier | Owner | Example |
|------|-------|---------|
| Daemon-pushed | Rust daemon via protocol events | Run state, PTY output, git status snapshots |
| Workspace-level | `WorkspaceStore` (`frontend/src/state/workspace-store.ts`) | Run list, output lines, selected run, diff panel, merge conflicts |
| Pane-local | `useState` inside the component | Hovered button, input draft, pane header edit mode |

Rule: if two panes of the same kind would want to share it, it belongs in `WorkspaceStore`. If it's throwaway UI state, keep it local.

## The `Empty` pane

`PaneKind::Empty` exists only in the frontend (`frontend/src/panes/empty/EmptyPane.tsx`). It is the default content after a split so the user can pick the target kind. Do not persist `Empty` panes to the daemon layout — they are replaced in place when the user chooses a kind.

## Adding a new pane type

Concrete checklist. The goal is that a new pane is visible in about 6 file touches.

1. **Rust `PaneKind`** — add the variant to `crates/terminal-core/src/models.rs` `PaneKind` enum.
2. **Serialization test** — add a roundtrip test in the same `#[cfg(test)] mod tests` block (see the existing `pane_layout_default_git` test as a template).
3. **Frontend `PaneKind`** — add the literal to `frontend/src/domain/pane/types.ts` union and to the `PANE_LABELS` table in `frontend/src/panes/PaneRenderer.tsx:9`.
4. **Component** — create `frontend/src/panes/<kind>/XxxPane.tsx`. Accept `PaneProps`. At the bottom: `registerPane('<Kind>', XxxPane);`.
5. **Side-effect import** — add `import './panes/<kind>/XxxPane';` to `frontend/src/App.tsx:29-37`.
6. **(Optional) Mode default** — if the pane is the primary content of a mode, reference it from a `ModeDefinition.defaultLayout()` in `frontend/src/modes/definitions.ts`. See [modes.md](modes.md).
7. **(Optional) Command palette entry** — register a `pane:open-<kind>` command in `frontend/src/core/shortcutMap.ts` so users can open the pane without menus.

Do **not** create a README inside `frontend/src/panes/<kind>/`. The checklist above is the authoritative onboarding doc.

## Pane chrome

`PaneRenderer` renders a consistent header on every pane (see `frontend/src/panes/PaneRenderer.tsx:22-60`):

- icon + label (from `PANE_LABELS`, overridable via `PaneDefinition.label`)
- focus ring (`--terminal-pane-focus` CSS variable, applied when `focused: true`)
- inline split buttons (`Columns2` / `Rows2` icons) and close (`X`) when `canClose`
- double-click label to rename

Panes should not draw their own outer border or title bar. Let the chrome handle it.

## DOM identity

`PaneRenderer` is the only place that stamps pane identity on the DOM, on the wrapper it renders around each pane:

- `data-pane-id` — the pane's id, the handle tests and the UAT use to find a pane
- `data-pane-kind` — the `PaneKind` from the layout, capitalised (`Terminal`, `GitStatus`, `FileExplorer`, …)

The invariant is **one pane, one `data-pane-kind`**. A pane component must not stamp the attribute on anything of its own: a second one lower in the tree makes `[data-pane-kind]` match the same pane twice, so any code that enumerates or counts panes (keybinding scope checks, UAT probes) reads two of something there is one of. If a test needs to find an element inside a specific pane, select it as a descendant — `[data-pane-kind="Terminal"] .xterm-screen` — rather than adding a marker that looks like pane identity.

## Related

- [modes.md](modes.md) — which panes a new workspace starts with
- [workspaces.md](workspaces.md) — how pane state is persisted
- [keybindings.md](keybindings.md) — how focus moves between panes
