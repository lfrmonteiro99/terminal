import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupDataDir } from './global-setup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INFO_PATH = resolve(__dirname, '.e2e-info.json');

export default async function globalTeardown() {
  if (!existsSync(INFO_PATH)) return;

  let info: { pid?: number; dataDir?: string } = {};
  try {
    info = JSON.parse(readFileSync(INFO_PATH, 'utf-8'));
  } catch {
    /* ignore */
  }

  if (info.pid) {
    try {
      process.kill(info.pid, 'SIGTERM');
      // Give it a moment to flush, then SIGKILL if still alive.
      await new Promise((r) => setTimeout(r, 500));
      try {
        process.kill(info.pid, 0);
        process.kill(info.pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    } catch {
      /* already gone */
    }
  }

  if (info.dataDir) cleanupDataDir(info.dataDir);

  try {
    unlinkSync(INFO_PATH);
  } catch {
    /* ignore */
  }
}
