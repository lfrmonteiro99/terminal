import { describe, it, expect } from 'vitest';
import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_ORDER,
  layoutSignature,
  matchPreset,
} from './layoutPresets';

describe('layoutPresets table', () => {
  it('binds every id in the order list to a preset whose id matches its key', () => {
    for (const id of LAYOUT_PRESET_ORDER) {
      const preset = LAYOUT_PRESETS[id];
      expect(preset, `preset "${id}" is in LAYOUT_PRESET_ORDER but not in the table`).toBeDefined();
      expect(preset.id).toBe(id);
    }
  });

  it('has no preset missing from the order list (it would be unreachable by Ctrl+Alt+N)', () => {
    expect(Object.keys(LAYOUT_PRESETS).sort()).toEqual([...LAYOUT_PRESET_ORDER].sort());
  });

  it('appends new presets: the first four keep their Ctrl+Alt+1..4 bindings', () => {
    // Guards against inserting a preset in the middle, which would silently
    // rebind shortcuts people already have in their fingers.
    expect(LAYOUT_PRESET_ORDER.slice(0, 4)).toEqual(['terminal', 'ai', 'git', 'browser']);
  });

  it('gives every preset a unique label and a description', () => {
    const labels = LAYOUT_PRESET_ORDER.map((id) => LAYOUT_PRESETS[id].label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    for (const id of LAYOUT_PRESET_ORDER) {
      expect(LAYOUT_PRESETS[id].description.length).toBeGreaterThan(0);
    }
  });

  it('gives every pane inside a preset a unique id (a preset is a fresh layout)', () => {
    for (const id of LAYOUT_PRESET_ORDER) {
      const seen: string[] = [];
      const walk = (n: unknown): void => {
        const node = n as { Single?: { id: string }; Split?: { first: unknown; second: unknown } };
        if (node.Single) seen.push(node.Single.id);
        else if (node.Split) { walk(node.Split.first); walk(node.Split.second); }
      };
      walk(LAYOUT_PRESETS[id].layout);
      expect(new Set(seen).size, `duplicate pane id inside preset "${id}"`).toBe(seen.length);
    }
  });
});

describe('layoutSignature', () => {
  it('describes the arrangement of kinds', () => {
    expect(layoutSignature(LAYOUT_PRESETS.terminal.layout)).toBe('Terminal');
    expect(layoutSignature(LAYOUT_PRESETS.git.layout)).toBe('Horizontal(GitStatus,GitHistory)');
  });

  it('ignores ids, ratios and resource links', () => {
    const dragged = {
      Split: {
        direction: 'Horizontal' as const,
        ratio: 0.13,
        first: { Single: { id: 'renamed-7', kind: 'Terminal' as const, resource_id: 'sess-42' } },
        second: { Single: { id: 'other', kind: 'Changes' as const, resource_id: 'file.txt' } },
      },
    };
    expect(layoutSignature(dragged)).toBe('Horizontal(Terminal,Changes)');
  });
});

describe('matchPreset', () => {
  it('recognises each preset from its own layout', () => {
    for (const id of LAYOUT_PRESET_ORDER) {
      expect(matchPreset(LAYOUT_PRESETS[id].layout)).toBe(id);
    }
  });

  it('still recognises a preset after the divider is dragged and a file is opened', () => {
    const dragged = {
      Split: {
        direction: 'Horizontal' as const,
        ratio: 0.77,
        first: { Single: { id: 'terminal-0', kind: 'Terminal' as const, resource_id: 'pty-9' } },
        second: { Single: { id: 'changes-0', kind: 'Changes' as const, resource_id: 'src/a.ts' } },
      },
    };
    expect(matchPreset(dragged)).toBe('changes');
  });

  it('returns null for a hand-built arrangement', () => {
    const custom = {
      Split: {
        direction: 'Vertical' as const,
        ratio: 0.5,
        first: { Single: { id: 'a', kind: 'Terminal' as const, resource_id: null } },
        second: { Single: { id: 'b', kind: 'Search' as const, resource_id: null } },
      },
    };
    expect(matchPreset(custom)).toBeNull();
  });

  it('does not confuse a three-pane layout with a preset', () => {
    const three = {
      Split: {
        direction: 'Horizontal' as const,
        ratio: 0.5,
        first: { Single: { id: 't', kind: 'Terminal' as const, resource_id: null } },
        second: {
          Split: {
            direction: 'Vertical' as const,
            ratio: 0.5,
            first: { Single: { id: 'g', kind: 'GitStatus' as const, resource_id: null } },
            second: { Single: { id: 'h', kind: 'GitHistory' as const, resource_id: null } },
          },
        },
      },
    };
    expect(matchPreset(three)).toBeNull();
  });

  it('recognises a saved layout passed as an extra candidate', () => {
    // The built-ins stop being enough the moment someone builds "Terminal +
    // changes + Git" by hand — matching their saved copy is what keeps the
    // "replace your layout?" prompt from firing while they sit in it.
    const saved = {
      Split: {
        direction: 'Horizontal' as const,
        ratio: 0.5,
        first: { Single: { id: 'terminal-0', kind: 'Terminal' as const, resource_id: null } },
        second: {
          Split: {
            direction: 'Vertical' as const,
            ratio: 0.5,
            first: { Single: { id: 'changes-1', kind: 'Changes' as const, resource_id: null } },
            second: { Single: { id: 'git-2', kind: 'GitStatus' as const, resource_id: null } },
          },
        },
      },
    };
    expect(matchPreset(saved)).toBeNull();
    const extra = [{ id: 'mine-1', label: 'Terminal + changes + Git', layout: saved }];
    expect(matchPreset(saved, extra)).toBe('mine-1');
  });

  it('prefers the built-in when a saved layout is identical to one', () => {
    // Otherwise a copy of "Terminal only" would shadow the real one and the
    // check mark would land on the duplicate.
    const extra = [{ id: 'copy', label: 'my terminal', layout: LAYOUT_PRESETS.terminal.layout }];
    expect(matchPreset(LAYOUT_PRESETS.terminal.layout, extra)).toBe('terminal');
  });
});
