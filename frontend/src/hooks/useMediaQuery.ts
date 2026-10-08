// useMediaQuery — subscribe to a CSS media query from React.
//
// The shell needs to know the viewport class (phone vs desktop) because the
// difference is structural, not cosmetic: a fixed rail and a pane grid on
// desktop, an off-canvas drawer and a single visible pane on a phone. Deciding
// that in JS is honest — CSS alone cannot unmount a split layout.
//
// matchMedia is the right primitive rather than a resize listener: the browser
// evaluates the query (so it can never disagree with our CSS breakpoints) and
// fires a change event without us reading layout on every resize frame.

import { useEffect, useState } from 'react';

/**
 * Width below which the shell switches to its single-column mobile form.
 * Kept in sync with the `max-width: 767px` block in `styles/mobile.css`.
 */
export const MOBILE_BREAKPOINT = 768;

function canMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (!canMatchMedia()) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (!canMatchMedia()) return;

    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);

    // Re-sync on mount: the query string can differ between renders, and some
    // engines do not emit an initial change event for the current state.
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * True on phone-sized viewports. Defaults to the shell breakpoint; pass an
 * explicit width for narrower or wider cuts (e.g. a compact-drawer threshold).
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
  return useMediaQuery(`(max-width: ${breakpoint - 1}px)`);
}