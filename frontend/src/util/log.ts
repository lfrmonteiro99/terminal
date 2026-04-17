// Debug logger — no-ops in production unless terminal:debug flag is set.
const isDebug = () =>
  import.meta.env.DEV || localStorage.getItem('terminal:debug') === 'true';

export function debug(...args: unknown[]): void {
  if (isDebug()) {
    console.log(...args);
  }
}
