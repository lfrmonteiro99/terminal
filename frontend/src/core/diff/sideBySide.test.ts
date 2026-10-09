import { describe, it, expect } from 'vitest';
import { parseDiffLines } from './parse';
import { toSideBySide } from './sideBySide';

const DIFF = [
  'diff --git a/crates/terminal-daemon/src/dispatcher.rs b/crates/terminal-daemon/src/dispatcher.rs',
  'index 4d67a2e..9f0b1c2 100644',
  '--- a/crates/terminal-daemon/src/dispatcher.rs',
  '+++ b/crates/terminal-daemon/src/dispatcher.rs',
  '@@ -1691,8 +1691,6 @@ fn do_start_run(',
  '     // so the DirtyWarning retry echoes back',
  '     // exactly what the client asked for.',
  '     let requested_autonomy = autonomy;',
  '-    let autonomy = autonomy',
  '-        .or(agent.as_ref().map(|a| a.default_autonomy))',
  '-        .unwrap_or_default();',
  '+    let autonomy = resolve_autonomy(autonomy, agent.as_ref());',
  ' ',
  '     // Resolve the workspace this run belongs to',
].join('\n');

describe('parseDiffLines', () => {
  it('parses the hunk header for the starting line numbers', () => {
    const lines = parseDiffLines(DIFF);
    const added = lines.find((l) => l.type === 'added')!;
    // Hunk starts at new line 1691; three context lines precede the addition,
    // so the added line is 1694.
    expect(added.newNum).toBe('1694');
    expect(added.text).toBe('+    let autonomy = resolve_autonomy(autonomy, agent.as_ref());');
  });

  it('keeps removed lines numbered on the old side only', () => {
    const removed = parseDiffLines(DIFF).filter((l) => l.type === 'removed');
    expect(removed.map((l) => l.oldNum)).toEqual(['1694', '1695', '1696']);
    expect(removed.every((l) => l.newNum === '')).toBe(true);
  });

  it('classifies file headers as meta, not as added/removed', () => {
    // Regression: `--- a/…` and `+++ b/…` start with -/+ and used to be
    // swallowed as a removed/added pair, polluting the change count.
    const lines = parseDiffLines(DIFF);
    const first = lines[0];
    expect(first.type).toBe('meta');
    expect(lines.filter((l) => l.type === 'added')).toHaveLength(1);
    expect(lines.filter((l) => l.type === 'removed')).toHaveLength(3);
  });

  it('numbers context lines on both sides', () => {
    const ctx = parseDiffLines(DIFF).filter((l) => l.type === 'normal');
    expect(ctx[0].oldNum).toBe('1691');
    expect(ctx[0].newNum).toBe('1691');
  });
});

describe('toSideBySide', () => {
  it('pairs an uneven change run and blanks the missing side', () => {
    const rows = toSideBySide(parseDiffLines(DIFF));
    const changes = rows.filter((r) => r.kind === 'change');
    // 3 removals vs 1 addition → three rows, the last two with an empty right.
    expect(changes).toHaveLength(3);
    expect(changes[0].left?.text).toBe('    let autonomy = autonomy');
    expect(changes[0].right?.text).toBe('    let autonomy = resolve_autonomy(autonomy, agent.as_ref());');
    expect(changes[1].left?.text).toBe('        .or(agent.as_ref().map(|a| a.default_autonomy))');
    expect(changes[1].right).toBeNull();
    expect(changes[2].right).toBeNull();
  });

  it('carries both line numbers into the pair', () => {
    const rows = toSideBySide(parseDiffLines(DIFF));
    const first = rows.find((r) => r.kind === 'change')!;
    if (first.kind !== 'change') throw new Error('unreachable');
    expect(first.left?.num).toBe('1694');
    expect(first.right?.num).toBe('1694');
  });

  it('renders hunks and metadata as full-width rows', () => {
    const rows = toSideBySide(parseDiffLines(DIFF));
    const full = rows.filter((r) => r.kind === 'full');
    expect(full.map((r) => r.type)).toEqual(['meta', 'meta', 'meta', 'meta', 'hunk']);
  });

  it('duplicates context text on both sides', () => {
    const rows = toSideBySide(parseDiffLines(DIFF));
    const ctx = rows.filter((r) => r.kind === 'context');
    // Three leading, one deliberate blank (" "), one trailing — the blank line
    // is context too, which is easy to miss when counting by eye.
    expect(ctx).toHaveLength(5);
    expect(ctx[0].left.text).toBe(ctx[0].right.text);
    expect(ctx[3].left.text).toBe(' ');
  });

  it('flushes a change run that ends the diff', () => {
    const lines = parseDiffLines('@@ -1,1 +1,1 @@\n-old\n+new');
    const rows = toSideBySide(lines);
    expect(rows.at(-1)!.kind).toBe('change');
    expect(rows.filter((r) => r.kind === 'change')).toHaveLength(1);
  });

  it('handles a pure addition with no removal', () => {
    const lines = parseDiffLines('@@ -1,1 +1,2 @@\n keep\n+added');
    const changes = toSideBySide(lines).filter((r) => r.kind === 'change');
    expect(changes).toHaveLength(1);
    expect(changes[0].left).toBeNull();
    expect(changes[0].right?.text).toBe('added');
  });

  it('handles a pure deletion with no addition', () => {
    const lines = parseDiffLines('@@ -1,2 +1,1 @@\n-gone\n keep');
    const changes = toSideBySide(lines).filter((r) => r.kind === 'change');
    expect(changes).toHaveLength(1);
    expect(changes[0].left?.text).toBe('gone');
    expect(changes[0].right).toBeNull();
  });

  it('splits two change runs separated by context into two pairs', () => {
    const lines = parseDiffLines('@@ -1,4 +1,4 @@\n-a\n+A\n same\n-b\n+B');
    const changes = toSideBySide(lines).filter((r) => r.kind === 'change');
    expect(changes).toHaveLength(2);
    expect(changes[0].left?.text).toBe('a');
    expect(changes[0].right?.text).toBe('A');
    expect(changes[1].left?.text).toBe('b');
    expect(changes[1].right?.text).toBe('B');
  });

  it('emits nothing for an empty diff', () => {
    expect(toSideBySide(parseDiffLines(''))).toHaveLength(0);
  });
});