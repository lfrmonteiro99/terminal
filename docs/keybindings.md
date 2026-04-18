# Keybindings

The keybinding layer makes terminal panes usable without trapping the user. Shortcuts are scoped so shell input (`Ctrl+C`, arrows, `Ctrl+D`) goes to the active terminal while app-level actions stay reachable.

See [naming-conventions.md](naming-conventions.md) for shortcut ID naming.

## Three scopes

`frontend/src/core/keybindings.ts:3` defines `KeyBindingScope`:

```ts
export type KeyBindingScope = 'app' | 'pane';
```

| Scope  | Fires when focus is...          | Example                              |
|--------|----------------------------------|--------------------------------------|
| `app`  | **not** inside a terminal pane   | `Ctrl+K` (command palette), `Ctrl+B` (sidebar), `Ctrl+1`..`Ctrl+4` (mode switch) |
| `pane` | inside a terminal pane           | `Ctrl+Shift+|` split-right, `Ctrl+Shift+_` split-down |

There is no `layout` scope. The previous design doc mentioned one, but it was consolidated into `app`. All layout-affecting shortcuts are app-scoped because they must fire regardless of which pane has focus.

## Resolution

`installGlobalKeybindings()` installs a single `window.keydown` listener (`keybindings.ts:39-58`). On each event:

1. Detect whether the event target is inside a terminal pane — it walks up the DOM looking for `[data-pane-kind="terminal"]`.
2. Skip `'pane'`-scoped bindings when the target is not inside a terminal.
3. Skip `'app'`-scoped bindings when the target **is** inside a terminal (so shell input passes through).
4. Match `ctrl / shift / alt + key` literally against each registered binding's `keys` field. First match wins.
5. If a binding matches, `preventDefault()` and fire `binding.action()`.

There is no stacking order beyond registration order. In practice, only `app` and `pane` bindings exist today and they are disjoint.

## Shortcut map

User-configurable defaults live in `frontend/src/core/shortcutMap.ts`:

```ts
const DEFAULTS: Record<string, string> = {
  'pane:split-right': 'Ctrl+Shift+|',
  'pane:split-down':  'Ctrl+Shift+_',
  'layout:terminal':  'Ctrl+Alt+1',
  'layout:ai':        'Ctrl+Alt+2',
  'layout:git':       'Ctrl+Alt+3',
  'layout:browser':   'Ctrl+Alt+4',
  'sidebar:toggle':   'Ctrl+B',
  'sidebar:explorer': 'Ctrl+Shift+E',
  'sidebar:changes':  'Ctrl+Shift+G',
  'sidebar:git':      'Ctrl+Shift+H',
  'git:refresh':      'Ctrl+Shift+R',
  'git:push':         '',
  'git:pull':         '',
  'git:fetch':        '',
  'workspace:list':   '',
};
```

User overrides persist to `localStorage` under the key `terminal:shortcuts`. Empty string means "unbound" (surfaces in command palette without a visible shortcut).

Read with `getShortcut(id)`, write with `setShortcut(id, combo)`, reset with `resetShortcuts()`. The command palette (`frontend/src/components/CommandPalette.tsx`) reads directly from this map.

## Reserved shortcuts

Reserved combos that **must not** be bound for anything else:

| Combo          | Action                           | Why reserved |
|----------------|----------------------------------|--------------|
| `Ctrl+C`       | Copy / shell SIGINT             | Never bind app-level. Forwarded to pane in terminal context. |
| `Ctrl+D`       | Shell EOF                        | Same. |
| `Ctrl+Z`       | Shell suspend                    | Same. |
| Arrow keys     | Shell history / cursor           | Never bind app-level. |
| `Ctrl+1`..`Ctrl+4` | Activate mode shortcut       | Reserved for mode switching (see `ModeDefinition.shortcut` in [modes.md](modes.md)). |
| `Ctrl+K`       | Command palette                  | Standard platform shortcut; don't reuse. |
| `Ctrl+B`       | Toggle sidebar                   | See `shortcutMap.ts` default. |
| `Ctrl+W`       | Close pane (**app-intercepted**) | Browser / Tauri default is close-window. Must be captured at `installGlobalKeybindings` before the platform sees it. |

`Ctrl+W` is the common footgun: without app-level interception it will close the Tauri window or browser tab. The app handler calls `preventDefault()` before the platform reacts.

## Adding a new shortcut

1. **Pick an ID** — `domain:kebab-action`. Check `DEFAULTS` in `shortcutMap.ts` for collisions and the Reserved table above.
2. **Add to `DEFAULTS`** — include the default combo (or `''` if unbound by default).
3. **Register the binding** — in the component or service that owns the action, call `registerBinding({ id, keys: getShortcut('<id>'), scope: 'app', description, action })`. Unregister on teardown (`unregisterBinding(id)`).
4. **Command palette entry** — if the action should be discoverable, add a command entry that references the shortcut ID. The palette resolves the displayed combo via `getShortcut(id)`.
5. **Test on a terminal pane** — focus a terminal, press the combo, confirm it fires (app scope) or is forwarded to the shell (pane scope).

## How terminal panes capture input

`TerminalPane` (`frontend/src/panes/terminal/TerminalPane.tsx`) mounts xterm.js and does **not** register any bindings. Its root element sets `data-pane-kind="terminal"`. That attribute is the signal `installGlobalKeybindings` uses to forward events to xterm.

When a user focuses a terminal and types `Ctrl+C`:

1. DOM event lands on the xterm container.
2. Global listener sees `data-pane-kind="terminal"` on the target chain.
3. Any registered `'app'`-scope binding is skipped.
4. Default xterm handling runs, sends `\x03` to the PTY.

`'pane'`-scope bindings (like split shortcuts) still fire — those are the only way to trigger UI actions from inside a terminal pane today.

## Changing scope of an existing shortcut

If a shortcut needs to be moved from `'app'` to `'pane'` (or vice versa), you must rebind it — unregister with the old scope and register with the new one. There's no mutation helper. Expect a follow-up issue if users report friction here.

## Related

- [ux-conventions.md](ux-conventions.md) — focus model, which informs scope resolution
- [panes.md](panes.md) — the `data-pane-kind` attribute that gates terminal forwarding
- [modes.md](modes.md) — mode-activation shortcuts (`Ctrl+1`..`Ctrl+4`)
