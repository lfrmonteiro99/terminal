// TerminalPane — xterm.js terminal bound to a daemon PTY session (M4-02)
// Registers itself in the pane registry.

import 'xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { useSend } from '../../context/SendContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

type SessionState = 'idle' | 'creating' | 'active' | 'lost' | 'restoring';

export function TerminalPane({ pane: _pane, workspaceId }: PaneProps) {
  const send = useSend();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<{ write: (data: string) => void; dispose: () => void } | null>(null);

  // Ref to hold current sessionId for use inside closures that can't track state
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Dynamically load xterm.js to keep bundle lean
  useEffect(() => {
    let disposed = false;

    const initXterm = async () => {
      try {
        // @ts-ignore — xterm is a peer dep loaded at runtime
        const { Terminal } = await import('xterm');
        // @ts-ignore
        const { FitAddon } = await import('@xterm/addon-fit');
        if (disposed || !termRef.current) return;

        const terminal = new Terminal({
          theme: { background: '#0d1117', foreground: '#e0e0e0' },
          fontFamily: 'monospace',
          fontSize: 13,
          cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(termRef.current);
        fitAddon.fit();

        xtermRef.current = terminal;

        // Send user input to daemon PTY — use ref to avoid stale closure
        terminal.onData((data: string) => {
          if (sessionIdRef.current) {
            send({ type: 'WriteTerminalInput', session_id: sessionIdRef.current, data });
          }
        });

        // Resize observer — use ref to avoid stale closure
        const ro = new ResizeObserver(() => {
          fitAddon.fit();
          if (sessionIdRef.current) {
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              send({
                type: 'ResizeTerminal',
                session_id: sessionIdRef.current,
                cols: dims.cols,
                rows: dims.rows,
              });
            }
          }
        });
        if (termRef.current) ro.observe(termRef.current);

        return () => ro.disconnect();
      } catch {
        // xterm not installed — show fallback
      }
    };

    initXterm();
    return () => {
      disposed = true;
      xtermRef.current?.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Create a PTY session when component mounts (if no session yet)
  useEffect(() => {
    if (sessionState !== 'idle') return;
    setSessionState('creating');
    send({ type: 'CreateTerminalSession', workspace_id: workspaceId });
  }, [workspaceId, sessionState, send]);

  // Listen for terminal events routed from App.tsx via CustomEvent bus
  useEffect(() => {
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail;

      if (event.type === 'TerminalSessionCreated' && event.workspace_id === workspaceId && sessionState === 'creating') {
        setSessionId(event.session_id);
        setSessionState('active');
      }

      if (event.type === 'TerminalOutput' && event.session_id === sessionId) {
        xtermRef.current?.write(event.data);
      }

      if (event.type === 'TerminalSessionClosed' && event.session_id === sessionId) {
        setSessionState('lost');
      }
    };

    window.addEventListener('terminal-event', handler);
    return () => window.removeEventListener('terminal-event', handler);
  }, [workspaceId, sessionId, sessionState]);

  const handleReconnect = () => {
    setSessionState('idle');
    setSessionId(null);
  };

  return (
    <div data-pane-kind="terminal" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#0d1117' }}>
      {sessionState === 'lost' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            zIndex: 10,
          }}
        >
          <span style={{ color: '#ff6b6b', fontFamily: 'monospace', fontSize: 14 }}>
            Session lost
          </span>
          <button
            onClick={handleReconnect}
            style={{
              padding: '8px 16px',
              backgroundColor: '#4ecdc4',
              color: '#1a1a2e',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontWeight: 'bold',
            }}
          >
            Reconnect
          </button>
        </div>
      )}
      {/* xterm.js mount point */}
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden' }} />
      {!xtermRef.current && sessionState !== 'lost' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontFamily: 'monospace',
            fontSize: 13,
          }}
        >
          {sessionState === 'creating' ? 'Starting terminal...' : 'Terminal'}
        </div>
      )}
    </div>
  );
}

registerPane('Terminal', TerminalPane);
