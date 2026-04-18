import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Keep CI deterministic; run a single browser. Locally you can widen projects
// (e.g. webkit/firefox) if you really need cross-browser signal — these tests
// exercise the daemon protocol + React app, not rendering quirks.

const __dirname = dirname(fileURLToPath(import.meta.url));

// Port the e2e daemon binds to. Overridable so multiple suites can run side
// by side without clashing (CI matrix, local + CI).
const DAEMON_PORT = Number(process.env.TERMINAL_E2E_DAEMON_PORT ?? 3101);

// Fixed token: lets the test harness preload it into localStorage before
// navigating, avoiding the Auth token input screen.
const DAEMON_TOKEN = process.env.TERMINAL_E2E_AUTH_TOKEN ?? 'e2e-test-token';

// Vite dev server port — proxies /ws to the daemon above via VITE_DAEMON_WS_URL.
const VITE_PORT = Number(process.env.TERMINAL_E2E_VITE_PORT ?? 5273);

export default defineConfig({
  testDir: resolve(__dirname, 'e2e'),
  testMatch: /.*\.spec\.ts/,

  fullyParallel: false, // single daemon instance, tests share state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  reporter: process.env.CI ? [['github'], ['list']] : 'list',

  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  globalSetup: resolve(__dirname, 'e2e/global-setup.ts'),
  globalTeardown: resolve(__dirname, 'e2e/global-teardown.ts'),

  // Vite dev server — Playwright boots it before tests and kills it after.
  // VITE_DAEMON_WS_URL lets vite's /ws proxy target our e2e daemon port.
  webServer: {
    command: 'npm run dev -- --port ' + VITE_PORT + ' --strictPort',
    url: `http://127.0.0.1:${VITE_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_DAEMON_WS_URL: `ws://127.0.0.1:${DAEMON_PORT}`,
    },
  },
});

export const e2eConfig = { DAEMON_PORT, DAEMON_TOKEN, VITE_PORT };
