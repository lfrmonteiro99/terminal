// Golden path #5 — the AI Run pane renders its PromptComposer and
// Run/Plan button once a session is active. We deliberately don't kick off
// a real run (that would spawn `claude` and hit the network), but mounting
// the composer proves the AiRunPane + autonomy toggle + session wiring are
// all intact.

import { test, expect } from './fixtures';

test('AI Run pane mounts the prompt composer', async ({ sessionPage }) => {
  // Split right, then pick the AI Run card from the Empty pane chooser.
  await sessionPage.keyboard.press('Control+Shift+|');
  await sessionPage.getByRole('button', { name: /AI Run/ }).click();

  // Default autonomy is Autonomous → composer placeholder reflects it.
  const composer = sessionPage.getByPlaceholder(/ask Claude to do something/i);
  await expect(composer).toBeVisible({ timeout: 10_000 });

  // Submit button is gated on a non-empty prompt — a minimal contract check.
  const runBtn = sessionPage.getByRole('button', { name: 'Run', exact: true });
  await expect(runBtn).toBeDisabled();

  await composer.fill('summarise this repo');
  await expect(runBtn).toBeEnabled();
});
