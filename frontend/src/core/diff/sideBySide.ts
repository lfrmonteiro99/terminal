// Side-by-side diff construction.
//
// A unified diff interleaves removals and additions; a side-by-side view needs
// them paired row by row, with blanks where one side has no counterpart. This
// is pure: given parsed lines, return display rows. Keeping it out of the
// component is what makes the pairing testable — the interesting cases (runs of
// uneven length, changes at the very end) are otherwise buried in JSX.

import type { DiffLine } from './parse';

export interface SbCell {
  num: string;
  text: string;
}

export type SbRow =
  /** Spans both columns: hunk headers and file-level metadata. */
  | { kind: 'full'; type: 'hunk' | 'meta'; text: string }
  /** Unchanged line: same text on both sides, with its own line number each. */
  | { kind: 'context'; left: SbCell; right: SbCell }
  /** A change. Either side may be null when the run lengths differ. */
  | { kind: 'change'; left: SbCell | null; right: SbCell | null };

function cell(num: string, text: string): SbCell {
  return { num, text };
}

/**
 * Pair a run of removals with the run of additions that follows it.
 * Uneven runs produce null cells rather than padding with empty strings, so the
 * renderer can draw a real blank (and tests can tell "no line" from "empty line").
 */
function flushChange(dels: DiffLine[], adds: DiffLine[], out: SbRow[]): void {
  const n = Math.max(dels.length, adds.length);
  for (let i = 0; i < n; i++) {
    const d = dels[i];
    const a = adds[i];
    out.push({
      kind: 'change',
      left: d ? cell(d.oldNum, d.text.replace(/^-/, '')) : null,
      right: a ? cell(a.newNum, a.text.replace(/^\+/, '')) : null,
    });
  }
}

export function toSideBySide(lines: DiffLine[]): SbRow[] {
  const out: SbRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];

  const flush = () => {
    if (dels.length || adds.length) {
      flushChange(dels, adds, out);
      dels = [];
      adds = [];
    }
  };

  for (const line of lines) {
    if (line.type === 'removed') {
      // A removal after additions starts a new change pair…
      if (adds.length) flush();
      dels.push(line);
      continue;
    }
    if (line.type === 'added') {
      adds.push(line);
      continue;
    }

    // Any other line closes the current change run.
    flush();

    if (line.type === 'hunk' || line.type === 'meta') {
      out.push({ kind: 'full', type: line.type, text: line.text });
    } else {
      out.push({
        kind: 'context',
        left: cell(line.oldNum, line.text),
        right: cell(line.newNum, line.text),
      });
    }
  }

  flush();
  return out;
}