// Golden path #3 — a PTY session spins up behind the Terminal pane and the
// xterm canvas renders. We don't type-and-assert echo here (xterm draws to
// canvas, not the DOM) — the presence of the canvas + a session id is enough
// signal that the PtyManager ↔ WS wiring is alive.

import { test, expect } from './fixtures';

test('Terminal pane mounts an xterm session', async ({ sessionPage }) => {
  const pane = sessionPage.locator('[data-pane-kind="terminal"]').first();
  await expect(pane).toBeVisible();

  // xterm.js injects a .xterm container once TerminalPane has created a
  // session and attached the addon. If the daemon failed to StartSession
  // we'd land on the restore-prompt region instead.
  await expect(pane.locator('.xterm')).toBeVisible({ timeout: 10_000 });

  // Negative check: the "Failed to start terminal" alert should never appear
  // on the happy path. Catches regressions in PtyManager bootstrap.
  await expect(sessionPage.getByText('Failed to start terminal')).toBeHidden();
});
