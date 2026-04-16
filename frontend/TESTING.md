# Frontend testing (M14)

## Commands

| Script | Purpose |
|--------|---------|
| `npm run test` | Single CI run (vitest run) |
| `npm run test:watch` | Re-runs on file save |
| `npm run test:coverage` | v8 coverage report (requires `@vitest/coverage-v8`) |

## Config

- Runner: **vitest 4**
- DOM: **jsdom** (`vitest.config.ts`)
- Globals: enabled (no need to import `describe`/`it`/`expect`)
- Test file glob: `src/**/*.test.{ts,tsx}`

Tests live next to the code they cover (e.g. `workspace-store.ts` +
`workspace-store.test.ts`).

## What's covered

Priority targets from #83:

| Module | Test file | Shape |
|--------|-----------|-------|
| `core/events/eventRouter.ts` | `eventRouter.test.ts` | Exhaustive `Record<AppEvent['type'], AppEvent>` samples — one per variant |
| `state/app-store.ts` | `app-store.test.ts` | One test per `AppStoreAction` variant + completeness gate |
| `state/workspace-store.ts` | `workspace-store.test.ts` | One test per `WorkspaceAction` variant + completeness gate |
| `core/commands/commandBus.ts` | `commandBus.test.ts` | Forwarding contract + singleton init |
| `core/daemon/resolveDaemonWsUrl.ts` | `resolveDaemonWsUrl.test.ts` | Precedence: Tauri > runtime config > same-origin |
| `panes/empty/EmptyPane.tsx` | `EmptyPane.test.tsx` | Render smoke test |

## Conventions

### Reducer tests

For reducers, the pattern is:

1. Track action tags via a `covered` set — `run()` wrapper adds each dispatched
   tag.
2. Final completeness test asserts every variant has been exercised, using
   `satisfies readonly WorkspaceAction['type'][]` so a renamed/removed tag
   breaks compilation.

This means adding a new action without a test fails the "covers every variant"
check.

### Event router

`eventRouter.test.ts` uses `Record<AppEvent['type'], AppEvent>` for the sample
table — TypeScript forbids missing keys at compile time. At runtime, the
`assertNever` default arm in `eventRouter.ts` turns any unhandled protocol
variant into a thrown error.

### Pane smoke tests

Pane components that depend on `AppContext` need the provider wrapped in a
helper (not yet written — see `EmptyPane.test.tsx` for the context-free case).
Every pane's smoke test should at minimum render without throwing.

### Mocking

- WebSocket / send fn → `vi.fn()` (see `commandBus.test.ts`).
- `window.__TERMINAL_CONFIG__` / `__TERMINAL_DAEMON_INFO__` → set in
  `beforeEach`, restored in `afterEach` (see `resolveDaemonWsUrl.test.ts`).
- `@testing-library/react` `cleanup()` called in `afterEach` for pane tests.

## When to add a test

- **New `AppStoreAction` / `WorkspaceAction` variant** → add a case in the
  matching `*-store.test.ts` AND extend the completeness array.
- **New `AppEvent` variant** → TS will force you to extend `eventRouter.ts`;
  also add an entry to `SAMPLES` in `eventRouter.test.ts`.
- **New `AppCommand`** → either add it to the `samples` list in
  `commandBus.test.ts` or rely on the existing forwarding contract.
- **New pane** → add a render smoke test alongside the component.
