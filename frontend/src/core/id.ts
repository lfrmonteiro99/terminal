// Stable IDs for client-side entities (quick commands, toasts).
//
// `crypto.randomUUID()` is only exposed in a SECURE CONTEXT (HTTPS, localhost,
// file://). The app is routinely opened over plain HTTP on a LAN / Tailscale IP
// — which is exactly the mobile-first case — and there `randomUUID` is
// `undefined`. Calling it directly throws inside a state updater, which React
// surfaces as a render error and the ErrorBoundary swallows the whole app.
//
// `crypto.getRandomValues()` has no such restriction, so it is the real
// fallback. Format follows RFC 4122 version 4 (the `4` and `8/9/a/b` nibbles
// are forced) so IDs stay the same shape as the native implementation.

export function newId(): string {
  const c = globalThis.crypto;

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      hex.push(bytes[i].toString(16).padStart(2, '0'));
    }
    const s = hex.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }

  // Last resort (no WebCrypto at all). Not cryptographically strong, but these
  // IDs are React keys and localStorage handles, not security tokens.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}