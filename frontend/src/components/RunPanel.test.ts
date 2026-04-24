import { describe, expect, it } from 'vitest';
import { extractFileLineRefs } from './runPanelFileLinks';

describe('extractFileLineRefs', () => {
  it('extracts path:line and path:line:col references', () => {
    const refs = extractFileLineRefs('error at src/main.rs:42 and ./foo/bar.ts:10:3');
    expect(refs).toEqual([
      expect.objectContaining({ path: 'src/main.rs', line: 42 }),
      expect.objectContaining({ path: './foo/bar.ts', line: 10 }),
    ]);
  });

  it('returns empty when no file reference is present', () => {
    expect(extractFileLineRefs('all good, no stack trace')).toEqual([]);
  });
});
