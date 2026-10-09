// Vitest global setup.
//
// Why this exists: Node 26 ships an experimental `localStorage` global that is
// `undefined` unless the process is started with `--localstorage-file`. jsdom
// also provides one, but the Node global wins during environment setup, so
// modules that read `localStorage` at import time (AppContext seeds
// `diffPanel.mode` from it) blow up with "Cannot read properties of undefined".
// Installing a plain in-memory Storage here makes every suite independent of
// the host Node version and of jsdom's origin rules.

class MemoryStorage implements Storage {
  #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }

  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.#map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, String(value));
  }
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  const existing = globalThis[name] as Storage | undefined;
  // A real, working Storage (jsdom on older Node) can stay.
  if (existing && typeof existing.getItem === 'function') return;
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

install('localStorage');
install('sessionStorage');
