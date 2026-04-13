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
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 24,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: '0.01em',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--accent-primary)',
            opacity: 0.35,
            boxShadow: '0 0 14px rgba(var(--accent-primary-rgb), 0.25)',
          }}
        />
        <div>no active run</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>start a session, then run a prompt</div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '14px 18px',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: 1.55,
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
      }}
    >
      {state.outputLines.map((line, i) => {
        const isStderr = line.startsWith('[stderr]');
        return (
          <div
            key={i}
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: isStderr ? 'var(--accent-error)' : 'var(--text-primary)',
              opacity: isStderr ? 0.95 : 1,
            }}
          >
            {line}
          </div>
        );
      })}
      {state.activeRun && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--accent-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            letterSpacing: '0.02em',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 8,
              height: 16,
              background: 'var(--accent-primary)',
              borderRadius: 1,
              animation: 'glow-pulse 1.4s ease-in-out infinite',
            }}
          />
          <span style={{ opacity: 0.85 }}>running</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
