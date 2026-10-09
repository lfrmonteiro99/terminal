// Tests for useMediaQuery / useIsMobile.
//
// jsdom ships no matchMedia, so these install a controllable stub — the point
// is to prove the two behaviours the shell depends on: the initial read, and
// the live reaction to a breakpoint change (rotating a phone, resizing a
// window) without a reload.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery, useIsMobile, MOBILE_BREAKPOINT } from './useMediaQuery';

type Listener = (e: { matches: boolean }) => void;

function installMatchMedia(initialMatches: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initialMatches,
    media: '',
    onchange: null,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
    dispatchEvent: () => true,
  };

  const matchMedia = vi.fn((query: string) => {
    mql.media = query;
    return mql as unknown as MediaQueryList;
  });

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMedia,
  });

  return {
    mql,
    matchMedia,
    fire(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((fn) => fn({ matches }));
    },
    listenerCount: () => listeners.size,
  };
}

let originalMatchMedia: unknown;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe('useMediaQuery', () => {
  it('reads the current state on first render', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the query flips', () => {
    const stub = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);

    act(() => stub.fire(true));
    expect(result.current).toBe(true);

    act(() => stub.fire(false));
    expect(result.current).toBe(false);
  });

  it('passes the query through to matchMedia verbatim', () => {
    const stub = installMatchMedia(true);
    renderHook(() => useMediaQuery('(min-width: 1200px)'));
    expect(stub.matchMedia).toHaveBeenCalledWith('(min-width: 1200px)');
  });

  it('unsubscribes on unmount (no listener leak)', () => {
    const stub = installMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(stub.listenerCount()).toBe(1);
    unmount();
    expect(stub.listenerCount()).toBe(0);
  });
});

describe('useIsMobile', () => {
  it('queries max-width one pixel below the breakpoint', () => {
    const stub = installMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(stub.matchMedia).toHaveBeenCalledWith(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    expect(result.current).toBe(true);
  });

  it('accepts a custom breakpoint', () => {
    const stub = installMatchMedia(false);
    renderHook(() => useIsMobile(1024));
    expect(stub.matchMedia).toHaveBeenCalledWith('(max-width: 1023px)');
  });
});