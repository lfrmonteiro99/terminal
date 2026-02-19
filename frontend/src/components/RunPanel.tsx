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
      <div style={{ padding: 24, color: '#888', fontFamily: 'monospace' }}>
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
        backgroundColor: '#1a1a2e',
        color: '#e0e0e0',
      }}
    >
      {state.outputLines.map((line, i) => (
        <div
          key={i}
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: line.startsWith('[stderr]') ? '#ff6b6b' : '#e0e0e0',
          }}
        >
          {line}
        </div>
      ))}
      {state.activeRun && (
        <div style={{ color: '#4ecdc4', marginTop: 8 }}>
          Running...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
