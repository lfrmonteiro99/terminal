// Golden path #1 — app loads, the WS handshake with the daemon succeeds, and
// the user lands on the Welcome screen. If this breaks, nothing else works.

import { test, expect } from './fixtures';

test('app connects to daemon and reaches Welcome screen', async ({ connectedPage }) => {
  // Welcome screen is the proof-of-connection: it only renders once WS status
  // flips to 'connected' and no session is active.
  await expect(connectedPage.getByText('Terminal Engine')).toBeVisible();
  await expect(connectedPage.getByText(/New Session/i)).toBeVisible();
  await expect(connectedPage.getByPlaceholder('/path/to/project')).toBeVisible();
});

test('rejects a bad auth token and shows the connection form', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('terminal:authToken', 'definitely-not-the-real-token');
  });
  await page.goto(baseURL ?? '/');

  // The welcome screen must NOT appear (no session start is possible without
  // a valid auth), and the connection form stays visible.
  await expect(page.getByPlaceholder('Daemon WebSocket URL')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByPlaceholder('/path/to/project')).toBeHidden();
});
