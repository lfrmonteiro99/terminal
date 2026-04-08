import { useEffect, useRef } from 'react';
import { useAppState } from '../context/AppContext';

export function RunPanel() {
  const state = useAppState();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.outputLines.length]);

  if (!state.activeRun && state.outputLines.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
        No active run. Start a session and run a prompt.
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '12px 16px',
        fontFamily: 'monospace',
        fontSize: 13,
        lineHeight: 1.5,
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
      }}
    >
      {state.outputLines.map((line, i) => (
        <div
          key={i}
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: line.startsWith('[stderr]') ? 'var(--accent-error)' : 'var(--text-primary)',
          }}
        >
          {line}
        </div>
      ))}
      {state.activeRun && (
        <div style={{ color: 'var(--accent-primary)', marginTop: 8 }}>
          Running...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
