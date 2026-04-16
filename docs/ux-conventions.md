# UX Conventions

Rules that keep the platform coherent across modes, panes, and contributors. These are constraints, not suggestions.

## App chrome (always visible)

`frontend/src/components/AppChrome.tsx` is drawn above the pane tree in every mode. It shows:

- workspace title (with inline rename)
- mode badge (icon from `ModeDefinition.icon`, label from `.label`)
- connection status indicator (green connected, amber authenticating, red disconnected)
- workspace switcher entry point
- global actions button (opens command palette)

`AppChrome` is single-row, fixed height (see `tokens.css` `--terminal-chrome-height`). It never scrolls, never collapses. If you're adding global UI, either put it in `AppChrome` or expose it through the command palette — do not add a new top-level strip.

The `StatusBar` (`frontend/src/components/StatusBar.tsx`) sits at the bottom and surfaces contextual info (branch, agent status, active-run line count). Clickable regions navigate or open panels.

## Pane chrome

`PaneRenderer` (`frontend/src/panes/PaneRenderer.tsx`) wraps every pane with consistent chrome:

- header bar: icon, label, split buttons, close button
- focus ring: `--terminal-pane-focus` border on the focused pane
- inline rename: double-click the label
- no pane draws its own outer border or title bar

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
- **Error state** — red accent (`--terminal-error`) on the affected element with a plain-language one-liner. Include a recovery action (retry, dismiss) where possible. No stack traces in the UI; log to the daemon instead.

`ErrorBoundary` (`frontend/src/components/ErrorBoundary.tsx`) catches unhandled render errors and shows a full-pane fallback with a reload button. Panes do not need their own error boundaries — the parent one suffices.

## Destructive actions

- Require explicit confirmation: close workspace (if it owns live runs or PTY sessions), force-push, reset --hard, delete branch.
- Non-destructive actions (stage, commit, create branch) fire immediately, with a reversible undo via git itself.
- `DirtyWarningModal` (`frontend/src/components/DirtyWarningModal.tsx`) is the pattern for dirty-state confirmations. Reuse it; don't invent new confirm dialogs.

## Color, density, motion

- **Theme** — driven by `frontend/src/styles/themes.ts` and `tokens.css`. Every visible color must resolve to a `--terminal-*` CSS variable. No hardcoded hex in component styles.
- **Density** — compact but readable. Default line-height 1.4, default font size 13 px. No spacer `<div>`s taller than 24 px.
- **Motion** — animations under 200 ms, use `--terminal-ease`. No bouncing, no oversized transitions. `animations.css` holds the shared keyframes.
- **Icons** — `lucide-react` only. Don't mix icon libraries.

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
- Don't introduce a third sidebar. `ActivityBar` + `SidebarContainer` is the full surface.
- Don't auto-hide the pane header. Users need the split/close affordances visible.
- Don't add "undo" UI for non-git actions. Git is the undo surface.

## Related

- [panes.md](panes.md) — what "pane chrome" wraps
- [keybindings.md](keybindings.md) — focus and input routing
- [architecture.md](architecture.md) — frontend layering that implements these conventions
