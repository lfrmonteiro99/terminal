import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Both the dev server and `vite preview` proxy `/ws` to the daemon so the SPA
// can use its same-origin default (`ws://<host>/ws`). This lets the built app
// be reached from another device (e.g. a phone over Tailscale) without exposing
// the daemon port directly.
//
// The target MUST be an origin, not a full URL with a path. Two traps:
//   1. `http-proxy` performs the WebSocket upgrade itself when `ws: true`;
//      handed a `ws://` target it fails the handshake (the browser sees a
//      1006/404 and the app silently falls back to its retry loop).
//   2. VITE_DAEMON_WS_URL is documented as `ws://host:port/ws`, and http-proxy
//      appends the request path to the target path — so keeping the `/ws` from
//      the env var produces `…:port/ws/ws` and a 404.
// Rebuilding the origin from the parsed URL handles both and keeps the env var
// honest to its documented shape.
const daemonTarget = (() => {
  const raw = process.env.VITE_DAEMON_WS_URL || 'ws://127.0.0.1:3000';
  const url = new URL(raw.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:'));
  return `${url.protocol}//${url.host}`;
})();

const wsProxy = {
  '/ws': {
    target: daemonTarget,
    ws: true,
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: wsProxy,
  },
  preview: {
    host: '0.0.0.0',
    proxy: wsProxy,
  },
})
