// TerminalPane — xterm.js terminal bound to a daemon PTY session (M4-02)
// Registers itself in the pane registry.

import { useEffect, useRef, useState } from 'react';
import { useSend } from '../../context/SendContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

type SessionState = 'idle' | 'creating' | 'active' | 'lost' | 'restoring';

export function TerminalPane({ pane, workspaceId }: PaneProps) {
  const send = useSend();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<{ write: (data: string) => void; dispose: () => void } | null>(null);

  // Dynamically load xterm.js to keep bundle lean
  useEffect(() => {
    let disposed = false;

    const initXterm = async () => {
      try {
        // @ts-ignore — xterm is a peer dep loaded at runtime
        const { Terminal } = await import('xterm');
        // @ts-ignore
        const { FitAddon } = await import('xterm-addon-fit');
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

        // Send user input to daemon PTY
        terminal.onData((data: string) => {
          if (sessionId) {
            send({ type: 'WriteTerminalInput', session_id: sessionId, data });
          }
        });

        // Resize observer
        const ro = new ResizeObserver(() => {
          fitAddon.fit();
          if (sessionId) {
            const dims = fitAddon.proposeDimensions();
            if (dims) {
              send({
                type: 'ResizeTerminal',
                session_id: sessionId,
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

  // Write terminal output coming from the daemon
  // (TerminalOutput events are routed via the workspace event bus and written here)
  const writeOutput = (data: string) => {
    xtermRef.current?.write(data);
  };

  const handleReconnect = () => {
    setSessionState('idle');
    setSessionId(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#0d1117' }}>
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
