# UX Conventions

Rules that keep the platform coherent across modes, panes, and contributors. These are constraints, not suggestions.

## App chrome (always visible)

`frontend/src/components/AppChrome.tsx` is drawn above the pane tree in every mode. It shows:

- workspace title (with inline rename)
- mode badge (icon from `ModeDefinition.icon`, label from `.label`)
- connection status indicator (green connected, amber authenticating, red disconnected)
- workspace switcher entry point
- global actions button (opens command palette)

`AppChrome` is single-row, fixed height (see `tokens.css` `--chrome-height`). It never scrolls, never collapses. If you're adding global UI, either put it in `AppChrome` or expose it through the command palette — do not add a new top-level strip.

On a phone the bar collapses to a hamburger + title and keeps only the refresh action: navigation moves into the drawer, and the branch/dirty chips move to the `StatusBar`. Do not re-add desktop controls to it — the breakpoint check (`useIsMobile`) is in `App.tsx`.

The `StatusBar` (`frontend/src/components/StatusBar.tsx`) sits at the bottom and surfaces contextual info (branch, agent status, active-run line count). Clickable regions navigate or open panels.

## Pane chrome

`PaneRenderer` (`frontend/src/panes/PaneRenderer.tsx`) wraps every pane with consistent chrome:

- header bar: icon, label, split buttons, close button
- focus ring: `--accent-primary` border on the focused pane
- inline rename: double-click the label
- no pane draws its own outer border or title bar

On a phone the pane grid is not drawn at all: the focused pane takes the whole surface and `MobilePaneSwitcher` (a bottom tab strip) moves between panes. Hidden panes stay **mounted** — terminals and run buffers must survive the switch. Split affordances are hidden on the phone, because there is nothing to arrange.

Consistency rule: if a pane needs a header action (like "refresh"), put it **inside** the pane body's top row — not in the chrome header. The chrome is for layout operations only.

## Focus model

- **One pane is focused at any time.** The focused pane has the `--terminal-pane-focus` ring.
- **Click-to-focus.** Clicking anywhere inside a pane focuses it. No hover focus, no keyboard-only focus.
- **Keyboard movement.** `Ctrl+Alt+Arrow` moves focus directionally (see `shortcutMap.ts`).
- **New panes steal focus.** When the user splits a pane, the new pane (typically `Empty`) becomes focused.
- **Terminal panes hold keyboard input.** See [keybindings.md](keybindings.md) — app-scope shortcuts are skipped while a terminal is focused.

Modals (command palette, dirty-warning modal, SSH connect dialog) trap focus until dismissed.

## Resize behavior

- Split ratios persist on the `PaneLayout::Split` node (`ratio: f32` in Rust, `ratio: number` in TS).
- Drag handles are inline on the split boundary (no dedicated resize affordance separate from the split seam).
- Minimum pane size: **120 px** per axis. Drags below that clamp at the minimum. If a pane would be smaller than 120 px, the drag is ignored — do not introduce scroll-to-see behavior.
- Double-clicking a split seam resets the ratio to 0.5.
- Ratios are persisted (debounced) to the workspace — see [workspaces.md](workspaces.md).

## Empty, loading, error states

Every pane has to handle all three. Conventions:

- **Empty state** — a centered one-line message and, where relevant, a single primary action. `frontend/src/components/WelcomeScreen.tsx` is the canonical example. No illustrations, no multi-paragraph copy.
- **Loading state** — inline spinner next to the element loading, not a full-pane overlay. Full-pane overlays block the user from doing other things and are reserved for destructive confirmations.
- **Error state** — red accent (`--state-danger`) on the affected element with a plain-language one-liner. Include a recovery action (retry, dismiss) where possible. No stack traces in the UI; log to the daemon instead.

`ErrorBoundary` (`frontend/src/components/ErrorBoundary.tsx`) catches unhandled render errors and shows a full-pane fallback with a reload button. Panes do not need their own error boundaries — the parent one suffices.

## Destructive actions

- Require explicit confirmation: close workspace (if it owns live runs or PTY sessions), force-push, reset --hard, delete branch.
- Non-destructive actions (stage, commit, create branch) fire immediately, with a reversible undo via git itself.
- `DirtyWarningModal` (`frontend/src/components/DirtyWarningModal.tsx`) is the pattern for dirty-state confirmations. Reuse it; don't invent new confirm dialogs.

## Color, density, motion

**Two independent layers** (`frontend/src/styles/`):

1. **Appearance** — light or dark neutrals. Owned by `appearance.ts` (`setScheme`), applied as `data-theme` + `data-appearance` on `<html>`. Every neutral palette lives in `themes.css` as a `:root[data-theme="…"]` block, generated from the table in `themes.ts`.
2. **Accent** — the user's colour, chosen in the Settings page from `palettes.ts`. Applied as inline `--accent-*` variables. Each palette carries two hexes (`dark` / `light`) so the same colour reads on both canvases.

The accent is *never* taken from a theme — picking Dracula must not silently change your accent. That separation is why `applyTheme` no longer writes inline styles: an inline custom property beats every stylesheet rule, which is exactly what made light mode unreachable before.

- **Tokens** — `tokens.css` is the only place literal colours live. Components read `var(--bg-surface)`, `var(--text-secondary)`, `var(--accent-primary)` … never a hex, never a raw palette value. Tokens are unprefixed (the older `--terminal-*` prefix in this doc was aspirational and never adopted).
- **Text on the accent is `var(--accent-fg)`**, not `var(--bg-base)`. The accent varies now; `--bg-base` only looked right by coincidence.
- **Never mix `border` shorthand with a `border*` longhand** in the same style object or on the same element (including imperative `style.borderColor = …` in a hover handler). React expands the shorthand and drops the longhand on rerender, logging "Removing borderColor border". Use `borderWidth` / `borderStyle` / `borderColor`.
- **Type scale** — `--font-size-2xs|xs|sm|base|md|lg|xl` (10/11/12/13/15/18/22). Hierarchy comes from size **and** weight **and** colour together; a component that sets only size is not hierarchy.
- **Space scale** — `--space-1…8` (4…32px). No ad-hoc padding numbers.
- **Density** — compact but readable. Body is `--font-size-base` (13 px) at `--leading-snug` (1.4). No spacer `<div>`s taller than 24 px.
- **Motion** — `--duration-fast|base|slow` (120/160/240 ms) with `--ease`. Nothing over 240 ms. `animations.css` holds the shared keyframes.
- **Icons** — `lucide-react` only. Don't mix icon libraries.
- **Terminal ANSI palette** — `--term-*` (16 slots) + `--term-selection`. Shell output picks from fixed ANSI slots, so these are the one palette that is not semantic — but it is still *ours*: xterm's built-in defaults are tuned for a pure-black background and are unreadable on light. Both appearances are asserted in `termPalette.test.ts` (every slot ≥ 4.5:1 on that appearance's `--bg-base`; `bright-*` ≥ 6.5:1 so the normal/bright ladder survives). Never map an ANSI slot to the accent — `ls --color`, git status and TUIs would lose their meaning.
- **Diff colours** — `--diff-add` / `--diff-del` and their `-bg` variants. They are convention colours, deliberately distinct from the accent, and they must follow the appearance.

## Responsive

The breakpoint is **768 px** (`MOBILE_BREAKPOINT` in `hooks/useMediaQuery.ts`, mirrored by the `max-width: 767px` block in `styles/mobile.css`). Change one, change the other.

The switch is **structural, not cosmetic**, so it lives in React (`useIsMobile`) — CSS cannot unmount a split layout:

| | Desktop | Phone |
|---|---|---|
| Navigation | fixed `NavRail` + resizable panel | off-canvas drawer (`MobileViewOverlay` holds the view) |
| Panes | split grid, drag-resizable | one pane at a time + `MobilePaneSwitcher` |
| Chrome | full command bar | hamburger + title |
| Diff | unified **or** side by side | unified only (two ~640 px columns do not fit) |

What stays in CSS is presentation only: the mobile type ramp (the desktop scale bottoms out at 10 px, too small at arm's length), `.touch-row` (44 px minimum), the `100dvh` app root (so the status bar and pane switcher are not hidden behind a collapsing browser toolbar) and safe-area insets. `index.html` sets `viewport-fit=cover` for those insets; zooming is deliberately left enabled.

Mobile-first rule: a control that only works with a mouse or a hover does not exist on the phone — either move it into a surface that does (drawer, overlay) or drop it there.

## Text

- Use plain verbs and nouns. "Stage file", not "Click here to stage".
- Capitalize only the first word and proper nouns in buttons and headers ("Create workspace", not "Create Workspace").
- Errors: say what happened and, if possible, the next action. Not "Something went wrong".
- No trailing periods in buttons, tooltips, or headers. Full sentences in modals, prose in docs.

## Toasts

`ToastContainer` (`frontend/src/components/ToastContainer.tsx`) handles transient feedback (copied to clipboard, branch switched, etc.). Rules:

- Toasts are informational, never blocking.
- Auto-dismiss after 3 seconds unless they carry an action.
- No more than two concurrent toasts. Newer replaces oldest.
- Errors prefer inline messaging over toasts — toasts are easy to miss.

## Discoverability

- Every action worth exposing lives in the command palette. If the palette doesn't know about it, the keybinding will feel arbitrary.
- Every shortcut is visible — either in a tooltip, `ShortcutCheatsheet.tsx`, or as the trailing label in the palette.
- The command palette is opened with `Ctrl+K`. This is reserved (see [keybindings.md](keybindings.md)).

## Anti-patterns

- Don't build mode-specific chrome. If it should appear in Git mode, think about whether it should just appear in the `GitStatus` pane.
- Don't block with full-screen spinners. Inline spinners.
- Don't introduce a second navigation surface. `NavRail` + `SidebarContainer` is the full surface — `Overview` and `Settings` are full-width pages, not extra rails.
- Don't auto-hide the pane header. Users need the split/close affordances visible.
- Don't add "undo" UI for non-git actions. Git is the undo surface.

## Related

- [panes.md](panes.md) — what "pane chrome" wraps
- [keybindings.md](keybindings.md) — focus and input routing
- [architecture.md](architecture.md) — frontend layering that implements these conventions
