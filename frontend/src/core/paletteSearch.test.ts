// Ranking rules for the command palette.
//
// The labels below are copied from CommandPalette's table on purpose: the bug
// this guards was a collision between a real preset label and a real destination
// label ('Layout: Git review' vs 'Git'), so a fixture that invents its own
// strings would not have caught it.

import { describe, it, expect } from 'vitest';
import { matchScore, rankCommands } from './paletteSearch';

/** The three-way collision, in the order the table declares them. */
const TABLE = [
  { id: 'layout:git', label: 'Layout: Git review', description: 'Git status beside the commit history' },
  { id: 'sidebar:git', label: 'Git', description: 'Open Git in a pane' },
  { id: 'git:refresh', label: 'Refresh Git Status', description: undefined },
  { id: 'add:gitstatus', label: 'Add Pane: Git Status', description: 'Add a git status pane' },
  { id: 'add:githistory', label: 'Add Pane: Git History', description: 'Add a git history pane' },
  { id: 'pane:split-right', label: 'Split Pane Right', description: 'Split the focused pane horizontally' },
];

const ids = (q: string) => rankCommands(TABLE, q).map((c) => c.id);

describe('matchScore', () => {
  it('ranks an exact label above a word-start match', () => {
    expect(matchScore({ label: 'Git' }, 'git')).toBeGreaterThan(
      matchScore({ label: 'Layout: Git review' }, 'git'),
    );
  });

  it('ranks a prefix above a word-start match', () => {
    expect(matchScore({ label: 'Git Status' }, 'git')).toBeGreaterThan(
      matchScore({ label: 'Layout: Git review' }, 'git'),
    );
  });

  it('ranks a label match above a description-only match', () => {
    expect(matchScore({ label: 'Split Pane Right' }, 'split')).toBeGreaterThan(
      matchScore({ label: 'Layout: Git review', description: 'split the terminal' }, 'split'),
    );
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchScore({ label: 'Git' }, '  GIT ')).toBe(matchScore({ label: 'Git' }, 'git'));
  });

  it('scores no match as 0', () => {
    expect(matchScore({ label: 'Git' }, 'zzz')).toBe(0);
  });
});

describe('rankCommands', () => {
  it('puts the destination called "Git" above the "Layout: Git review" preset', () => {
    // Pre-fix this list started with layout:git — table order, not relevance.
    expect(ids('git')[0]).toBe('sidebar:git');
  });

  it('still surfaces every command that mentions the query', () => {
    // Every one of these has 'git' at the start of a word, so they tie at
    // word-start and the table decides among them.
    expect(ids('git')).toEqual([
      'sidebar:git',
      'layout:git',
      'git:refresh',
      'add:gitstatus',
      'add:githistory',
    ]);
  });

  it('keeps table order when every match is equally good', () => {
    // All three are word-start hits on 'pane'; none is the exact label or a
    // prefix of one, so the table decides.
    const wordStarts = rankCommands(
      [
        { id: 'a', label: 'Add Pane: Search' },
        { id: 'b', label: 'Add Pane: Terminal' },
        { id: 'c', label: 'Move Pane' },
      ],
      'pane',
    );
    expect(wordStarts.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the table untouched for an empty query', () => {
    expect(rankCommands(TABLE, '')).toBe(TABLE);
    expect(rankCommands(TABLE, '   ')).toBe(TABLE);
  });

  it('returns an empty list when nothing matches', () => {
    expect(rankCommands(TABLE, 'zzz')).toEqual([]);
  });
});
