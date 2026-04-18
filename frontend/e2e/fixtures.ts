import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface E2eInfo {
  port: number;
  token: string;
  repoRoot: string;
}

export function readE2eInfo(): E2eInfo {
  const raw = readFileSync(resolve(__dirname, '.e2e-info.json'), 'utf-8');
  const json = JSON.parse(raw);
  return {
    port: json.port,
    token: json.token,
    repoRoot: process.env.TERMINAL_E2E_REPO_ROOT ?? json.repoRoot,
  };
}

// Fixture: a page that's already connected to the daemon. We seed the auth
// token into localStorage before navigation so the App skips the connection
// form and lands straight on WelcomeScreen once the WS handshake completes.
export const test = base.extend<{ connectedPage: Page; sessionPage: Page }>({
  connectedPage: async ({ page, baseURL }, use) => {
    const { token } = readE2eInfo();

    // Seed localStorage before app JS runs.
    await page.addInitScript((authToken) => {
      try {
        window.localStorage.setItem('terminal:authToken', authToken);
      } catch {
        /* storage disabled — tests will fail loudly at assertion time */
      }
    }, token);

    await page.goto(baseURL ?? '/');

    // WelcomeScreen shows once WS is connected and no session is active.
    await expect(page.getByPlaceholder('/path/to/project')).toBeVisible({
      timeout: 15_000,
    });
    await use(page);
  },

  // Fixture: a page with an active session on the e2e repo. Most specs want
  // this — it gets you past the Welcome screen to the main layout.
  sessionPage: async ({ page, baseURL }, use) => {
    const { token, repoRoot } = readE2eInfo();

    await page.addInitScript((authToken) => {
      try {
        window.localStorage.setItem('terminal:authToken', authToken);
      } catch {
        /* ignore */
      }
    }, token);

    await page.goto(baseURL ?? '/');

    const pathInput = page.getByPlaceholder('/path/to/project');
    await expect(pathInput).toBeVisible({ timeout: 15_000 });
    await pathInput.fill(repoRoot);
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    // Main layout is characterised by a Terminal pane by default.
    await expect(page.locator('[data-pane-kind="terminal"]')).toBeVisible({
      timeout: 10_000,
    });
    await use(page);
  },
});

export { expect };
