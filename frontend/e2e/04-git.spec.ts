// Golden path #4 — Git dispatcher responds to GetRepoStatus with the branch
// name. The GitStatusPane issues that command on mount, so merely opening
// the pane exercises the full daemon → git CLI → broadcast → reducer loop.

import { test, expect } from './fixtures';

test('Git Status pane shows the current branch', async ({ sessionPage }) => {
  // Open the command palette (Ctrl+K) — more reliable cross-platform than
  // the Ctrl+Shift+\| split shortcut, which needs a shifted punctuation key.
  await sessionPage.keyboard.press('Control+k');

  const palette = sessionPage.getByPlaceholder(/Type a command/);
  await expect(palette).toBeVisible();
  await palette.fill('Git Status');
  await sessionPage.keyboard.press('Enter');

  // Repo was git-init'd with the host's default branch in global-setup.
  // Accept either 'main' or 'master' — depends on git config init.defaultBranch.
  // The branch rendering is enough proof the full daemon→git-CLI loop worked.
  await expect(
    sessionPage.getByText(/^(main|master)$/).first(),
  ).toBeVisible({ timeout: 10_000 });
});
