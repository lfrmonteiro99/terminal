import type { CommitEntry } from '../../types/protocol';

function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
  if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
  if (diffSec < 604800) return Math.floor(diffSec / 86400) + 'd ago';
  return Math.floor(diffSec / 604800) + 'w ago';
}

const commitRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  padding: '3px 12px',
  fontSize: 11,
  fontFamily: 'monospace',
  cursor: 'default',
};

const hashStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 10,
  flexShrink: 0,
  width: 56,
};

const messageStyle: React.CSSProperties = {
  color: '#e0e0e0',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const timeStyle: React.CSSProperties = {
  color: '#555',
  fontSize: 10,
  flexShrink: 0,
  marginLeft: 'auto',
  paddingLeft: 8,
};

export function CommitHistoryItem({ commit }: { commit: CommitEntry }) {
  return (
    <div style={commitRowStyle}>
      <span style={hashStyle}>{commit.hash.slice(0, 7)}</span>
      <span style={messageStyle}>{commit.message}</span>
      <span style={timeStyle}>{relativeTime(commit.date)}</span>
    </div>
  );
}
