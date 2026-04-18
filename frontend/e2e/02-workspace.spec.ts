// Golden path #2 — starting a session against a real project root replaces
// the Welcome screen with the main layout (activity bar, sidebar, panes).

import { test, expect, readE2eInfo } from './fixtures';

test('starting a session opens the main layout', async ({ connectedPage }) => {
  const { repoRoot } = readE2eInfo();

  await connectedPage.getByPlaceholder('/path/to/project').fill(repoRoot);
  await connectedPage.getByRole('button', { name: 'Start', exact: true }).click();

  // Welcome dismissed.
  await expect(connectedPage.getByPlaceholder('/path/to/project')).toBeHidden({
    timeout: 10_000,
  });

  // Default layout contains a Terminal pane.
  await expect(connectedPage.locator('[data-pane-kind="terminal"]')).toBeVisible();
});

test('Start is disabled when no path is entered', async ({ connectedPage }) => {
  const startBtn = connectedPage.getByRole('button', { name: 'Start', exact: true });
  await expect(startBtn).toBeDisabled();

  await connectedPage.getByPlaceholder('/path/to/project').fill('  ');
  await expect(startBtn).toBeDisabled();

  await connectedPage.getByPlaceholder('/path/to/project').fill('/tmp');
  await expect(startBtn).toBeEnabled();
});
