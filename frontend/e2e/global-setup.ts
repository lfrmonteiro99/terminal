import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { e2eConfig } from '../playwright.config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

// Where we persist the spawned-daemon PID so teardown can kill it even if the
// Node process is restarted mid-run (rare, but keeps dev boxes tidy).
const INFO_PATH = resolve(__dirname, '.e2e-info.json');

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // The daemon's /ws endpoint rejects plain HTTP with 400 or 426 — any
      // response means the listener is accepting connections.
      const res = await fetch(url).catch(() => null);
      if (res) return;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function initTestRepo(root: string) {
  mkdirSync(root, { recursive: true });
  const run = (...args: string[]) =>
    spawnSync('git', args, { cwd: root, stdio: 'inherit' });
  run('init', '-q');
  run('config', 'user.email', 'e2e@example.com');
  run('config', 'user.name', 'e2e');
  writeFileSync(join(root, 'README.md'), '# e2e fixture\n');
  run('add', '.');
  run('commit', '-q', '-m', 'initial');
}

export default async function globalSetup() {
  const { DAEMON_PORT, DAEMON_TOKEN } = e2eConfig;

  // Isolated scratch dir per run so persisted state doesn't leak between runs.
  const dataDir = mkdtempSync(join(tmpdir(), 'terminal-e2e-'));
  const repoRoot = join(dataDir, 'repo');
  initTestRepo(repoRoot);

  // Build the daemon binary up front so the first test doesn't time out on a
  // cold cargo compile. Debug build is fine — dev laptops don't have release
  // toolchains warmed up and debug is ~5× faster to compile.
  const build = spawnSync(
    'cargo',
    ['build', '-p', 'terminal-daemon'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
  if (build.status !== 0) {
    throw new Error('cargo build -p terminal-daemon failed');
  }

  const binary = join(REPO_ROOT, 'target/debug/terminal-daemon');

  const child: ChildProcess = spawn(binary, [], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TERMINAL_HOST: '127.0.0.1',
      TERMINAL_PORT: String(DAEMON_PORT),
      TERMINAL_DATA_DIR: dataDir,
      TERMINAL_AUTH_TOKEN: DAEMON_TOKEN,
      RUST_LOG: process.env.RUST_LOG ?? 'warn',
    },
    stdio: 'inherit',
    detached: false,
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[e2e] daemon exited early: code=${code} signal=${signal}`);
    }
  });

  try {
    await waitFor(`http://127.0.0.1:${DAEMON_PORT}/ws`, 15_000);
  } catch (e) {
    child.kill('SIGKILL');
    throw e;
  }

  writeFileSync(
    INFO_PATH,
    JSON.stringify({
      pid: child.pid,
      port: DAEMON_PORT,
      token: DAEMON_TOKEN,
      dataDir,
      repoRoot,
    }),
  );

  // Pass the scratch repo to specs via env — Playwright reads process.env
  // inside test files.
  process.env.TERMINAL_E2E_REPO_ROOT = repoRoot;
  process.env.TERMINAL_E2E_DATA_DIR = dataDir;
}

export function cleanupDataDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
