import { describe, it, expect, beforeEach } from 'vitest';
import {
  addCustomPreset,
  loadCustomPresets,
  removeCustomPreset,
  MAX_CUSTOM_PRESETS,
} from './customPresets';
import type { PaneLayout } from '../domain/pane/types';

const singleTerminal: PaneLayout = {
  Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null },
};

const twoPane: PaneLayout = {
  Split: {
    direction: 'Horizontal',
    ratio: 0.5,
    first: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
    second: { Single: { id: 'changes-0', kind: 'Changes', resource_id: null } },
  },
};

describe('customPresets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty when nothing was ever saved', () => {
    expect(loadCustomPresets()).toEqual([]);
  });

  it('round-trips a saved layout', () => {
    addCustomPreset('Terminal + changes', twoPane, 'id-1');
    const loaded = loadCustomPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('id-1');
    expect(loaded[0].label).toBe('Terminal + changes');
    expect(loaded[0].layout).toEqual(twoPane);
  });

  it('keeps saving after the first, in order', () => {
    addCustomPreset('one', singleTerminal, 'id-1');
    addCustomPreset('two', twoPane, 'id-2');
    expect(loadCustomPresets().map((p) => p.label)).toEqual(['one', 'two']);
  });

  it('falls back to a placeholder name rather than saving a blank row', () => {
    addCustomPreset('   ', twoPane, 'id-1');
    expect(loadCustomPresets()[0].label).toBe('Untitled layout');
  });

  it('trims the name', () => {
    addCustomPreset('  review setup  ', twoPane, 'id-1');
    expect(loadCustomPresets()[0].label).toBe('review setup');
  });

  it('removes by id and leaves the rest alone', () => {
    addCustomPreset('one', singleTerminal, 'id-1');
    addCustomPreset('two', twoPane, 'id-2');
    const after = removeCustomPreset('id-1');
    expect(after.map((p) => p.id)).toEqual(['id-2']);
    expect(loadCustomPresets().map((p) => p.id)).toEqual(['id-2']);
  });

  it('removing an unknown id is a no-op, not a throw', () => {
    addCustomPreset('one', twoPane, 'id-1');
    expect(removeCustomPreset('nope').map((p) => p.id)).toEqual(['id-1']);
  });

  it('caps the library, dropping the oldest rather than refusing the save', () => {
    for (let i = 0; i < MAX_CUSTOM_PRESETS + 3; i++) {
      addCustomPreset(`layout ${i}`, twoPane, `id-${i}`);
    }
    const loaded = loadCustomPresets();
    expect(loaded).toHaveLength(MAX_CUSTOM_PRESETS);
    // The one just saved is kept; the earliest is the one that goes.
    expect(loaded[loaded.length - 1].label).toBe(`layout ${MAX_CUSTOM_PRESETS + 2}`);
    expect(loaded.some((p) => p.label === 'layout 0')).toBe(false);
  });

  it('survives rubbish in localStorage instead of taking the app down at boot', () => {
    localStorage.setItem('terminal:custom-layouts', '{not json');
    expect(loadCustomPresets()).toEqual([]);
  });

  it('drops entries that do not have the shape it needs', () => {
    localStorage.setItem(
      'terminal:custom-layouts',
      JSON.stringify([
        { id: 'ok', label: 'good', layout: twoPane },
        { id: 'no-layout', label: 'bad' },
        null,
        'nonsense',
      ]),
    );
    const loaded = loadCustomPresets();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('ok');
  });

  it('treats a non-array payload as empty', () => {
    localStorage.setItem('terminal:custom-layouts', JSON.stringify({ id: 'a' }));
    expect(loadCustomPresets()).toEqual([]);
  });
});
