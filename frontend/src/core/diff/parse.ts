// Unified-diff parsing.
//
// Extracted from DiffPanel so the side-by-side builder can share one parser
// (and so both are testable without a DOM).

export type DiffLineType = 'hunk' | 'added' | 'removed' | 'normal' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  oldNum: string;
  newNum: string;
}

/** `diff --git`, `index`, `---`, `+++`, `\ No newline…` — file-level headers. */
function isMeta(line: string): boolean {
  return (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('\\ No newline')
  );
}

export function parseDiffLines(diff: string): DiffLine[] {
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  const rawLines = diff.split('\n');
  // A unified diff ends with a newline, so split() leaves a trailing '' that is
  // not a line at all. A genuine blank line inside a diff is " " (a single
  // space), never "" — so dropping it is safe and stops an empty diff from
  // producing a phantom row.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'hunk', text: line, oldNum: '', newNum: '' });
    } else if (isMeta(line)) {
      // Checked before +/- so the `---`/`+++` file headers are not mistaken for
      // a removed/added line (they used to be swallowed as context).
      result.push({ type: 'meta', text: line, oldNum: '', newNum: '' });
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', text: line, oldNum: '', newNum: newLine > 0 ? String(newLine) : '' });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', text: line, oldNum: oldLine > 0 ? String(oldLine) : '', newNum: '' });
      oldLine++;
    } else {
      const oNum = oldLine > 0 ? String(oldLine) : '';
      const nNum = newLine > 0 ? String(newLine) : '';
      result.push({ type: 'normal', text: line, oldNum: oNum, newNum: nNum });
      if (oldLine > 0) oldLine++;
      if (newLine > 0) newLine++;
    }
  }

  return result;
}