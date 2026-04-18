# E2E tests (Playwright)

Browser-level tests that drive the Vite-served frontend against a real
`terminal-daemon` over WebSocket. Covers the five golden flows:

| Spec | Flow |
|------|------|
| `01-connect.spec.ts` | App loads, authenticates, reaches WelcomeScreen |
| `02-workspace.spec.ts` | Start a session → main layout appears |
| `03-terminal.spec.ts` | PTY session spins up behind the Terminal pane |
| `04-git.spec.ts` | Git dispatcher returns branch + clean status |
| `05-ai-run.spec.ts` | AI Run pane mounts the prompt composer |

The suite is intentionally narrow: it validates the cross-boundary wiring
(React ↔ WS ↔ daemon dispatchers), not every pane interaction. For pane-level
assertions use Vitest component tests (`*.test.tsx`).

## Running

```bash
cd frontend

# One-time: install the Chromium build Playwright ships with.
npm run e2e:install

# Run headless — builds the daemon via `cargo build -p terminal-daemon`
# on first run, spawns it on port 3101, starts `vite dev` on 5273.
npm run e2e

# Interactive UI (test runner, step-through):
npm run e2e:ui
```

## What's under the hood

`playwright.config.ts`
- Boots Vite via `webServer`, pointing its `/ws` proxy at the e2e daemon.
- Single `chromium` project; `workers: 1` — we share one daemon instance
  across specs, and fully-parallel tests would race on persisted state.

`e2e/global-setup.ts`
- Creates a fresh temp dir + `git init`-d repo (fixture project root).
- Runs `cargo build -p terminal-daemon` and spawns `target/debug/terminal-daemon`
  with `TERMINAL_AUTH_TOKEN=e2e-test-token`, `TERMINAL_PORT=3101`, pointed
  at the temp `TERMINAL_DATA_DIR`.
- Waits for `/ws` to accept connections, writes daemon info to
  `e2e/.e2e-info.json` for teardown + fixtures to read.

`e2e/global-teardown.ts`
- `SIGTERM` → `SIGKILL` fallback on the daemon PID, `rm -rf` the temp dir.

`e2e/fixtures.ts`
- `connectedPage` — WelcomeScreen reached (auth token seeded via localStorage).
- `sessionPage` — session started against the fixture repo, main layout shown.

## Overrides

| Env var | Default | Purpose |
|---------|---------|---------|
| `TERMINAL_E2E_DAEMON_PORT` | `3101` | Daemon port |
| `TERMINAL_E2E_VITE_PORT` | `5273` | Vite dev server port |
| `TERMINAL_E2E_AUTH_TOKEN` | `e2e-test-token` | Pre-seeded auth token |

## Adding a spec

1. Use the `sessionPage` fixture for most flows — you'll start in the main
   layout with the default Terminal pane focused.
2. Prefer role/text/placeholder locators — the app has few `data-testid`s.
   Add `aria-label` to the component you're targeting if you need a stable
   hook (see `TerminalPane.tsx:505` for precedent).
3. Keep specs narrow: one flow, minimal assertions. Anything exercising
   internal state or reducers belongs in Vitest.
