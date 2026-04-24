export interface FileLineRef {
  path: string;
  line: number;
  start: number;
  end: number;
}

// Matches common compiler/stack formats:
//   src/main.rs:42
//   ./src/main.ts:10:2
const FILE_LINE_RE = /((?:\.{0,2}\/)?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9_]+):(\d+)(?::\d+)?/g;

export function extractFileLineRefs(line: string): FileLineRef[] {
  const refs: FileLineRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = FILE_LINE_RE.exec(line)) !== null) {
    const path = match[1];
    const lineNumber = Number(match[2]);
    if (!path || !Number.isFinite(lineNumber)) continue;
    refs.push({
      path,
      line: lineNumber,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return refs;
}
