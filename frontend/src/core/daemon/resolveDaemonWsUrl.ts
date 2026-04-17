// Resolve the daemon WebSocket URL at runtime (M16).
//
// Order of precedence:
// 1. Tauri: use the port/token injected by the native shell (via
//    `get_daemon_info` — callers typically override this resolver in that
//    code path).
// 2. Runtime config: `window.__TERMINAL_CONFIG__.wsUrl` — lets operators
//    override without rebuilding the image (e.g. split deployments).
// 3. Same-origin default: `ws(s)://<host>/ws`. This works under a reverse
//    proxy (compose/nginx), under `vite dev` (thanks to its `/ws` proxy),
//    and under the Tauri bundled static server.
//
// NOTE: we deliberately do NOT read `import.meta.env.VITE_*`. That would
// inline the URL at build time and make the image non-portable (#85).

export interface RuntimeDaemonInfo {
  wsUrl?: string;
  token?: string;
}

declare global {
  interface Window {
    __TERMINAL_CONFIG__?: RuntimeDaemonInfo;
    __TERMINAL_DAEMON_INFO__?: RuntimeDaemonInfo & { port?: number };
  }
}

export function resolveDaemonWsUrl(): string {
  // Tauri injects either a full URL or a port.
  const tauri = typeof window !== 'undefined' ? window.__TERMINAL_DAEMON_INFO__ : undefined;
  if (tauri?.wsUrl) return tauri.wsUrl;
  if (tauri?.port) return `ws://127.0.0.1:${tauri.port}/ws`;

  // Runtime override (written by a deploy script into index.html).
  const runtime = typeof window !== 'undefined' ? window.__TERMINAL_CONFIG__ : undefined;
  if (runtime?.wsUrl) return runtime.wsUrl;

  // Same-origin default.
  if (typeof window !== 'undefined' && window.location) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  // SSR / test fallback.
  return 'ws://127.0.0.1:3000/ws';
}
