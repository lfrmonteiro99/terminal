import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    // Default is one worker per core — 12 here. That pins every core for the
    // whole run and the machine stops answering (observed: the box thrashed
    // while a suite of 23 files ran). The suite is small; 2 workers cost a few
    // seconds and leave 10 cores free. The limit is about keeping the machine
    // usable, not about the tests.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
