// Golden path #4 — Git dispatcher responds to GetRepoStatus with the branch
// name. The GitStatusPane issues that command on mount, so merely opening
// the pane exercises the full daemon → git CLI → broadcast → reducer loop.

import { test, expect } from './fixtures';

test('Git Status pane shows the current branch', async ({ sessionPage }) => {
  // Split the default Terminal pane into an Empty pane, then pick GitStatus.
  // Ctrl+Shift+| is the split-right shortcut registered in App.tsx.
  await sessionPage.keyboard.press('Control+Shift+|');

  // The new pane is Empty by default and shows a chooser with a "Git Status"
  // card. Click it to swap the pane kind.
  await sessionPage.getByRole('button', { name: /Git Status/ }).click();

  // Repo was git-init'd with a default branch in global-setup. Accept either
  // 'main' or 'master' since that's git config dependent.
  await expect(
    sessionPage.getByText(/^(main|master)$/).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Empty working tree from the fresh init.
  await expect(sessionPage.getByText('no changed files')).toBeVisible();
});
