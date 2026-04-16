export function debug(...args: unknown[]) {
  if (import.meta.env.DEV || localStorage.getItem('terminal:debug')) {
    console.log(...args);
  }
}
