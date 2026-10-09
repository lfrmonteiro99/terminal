import { describe, it, expect, vi, afterEach } from 'vitest';
import { newId } from './id';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('uses the native implementation when randomUUID is available', () => {
    const native = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    vi.stubGlobal('crypto', { randomUUID: native });

    expect(newId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('falls back to getRandomValues in an insecure context (no randomUUID)', () => {
    // This is the mobile-over-HTTP case: `crypto` exists, `randomUUID` does not.
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
        return arr;
      },
    });

    const id = newId();

    expect(id).toMatch(UUID_V4);
    // Bytes 1..16 with version/variant nibbles forced -> deterministic check.
    expect(id.startsWith('01020304-0506-4708-')).toBe(true);
  });

  it('produces valid, distinct v4 ids with the real WebCrypto', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id).toMatch(UUID_V4);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });

  it('survives a total absence of WebCrypto', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newId()).toMatch(UUID_V4);
  });
});