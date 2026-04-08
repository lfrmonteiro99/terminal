// TerminalPane — xterm.js terminal bound to a daemon PTY session (M4-02)
// Registers itself in the pane registry.

import 'xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { useSend } from '../../context/SendContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

type SessionState = 'idle' | 'creating' | 'active' | 'lost' | 'restoring';

// FIFO queue: panes register when they send CreateTerminalSession,
// and TerminalSessionCreated events are matched in order.
type PendingClaim = { resolve: (sessionId: string) => void; workspaceId: string };
const pendingQueue: PendingClaim[] = [];

function waitForSession(workspaceId: string): Promise<string> {
  return new Promise((resolve) => {
    pendingQueue.push({ resolve, workspaceId });
  });
}

// Called from the event handler — resolves the first matching pending claim
function claimSession(workspaceId: string, sessionId: string): boolean {
  const idx = pendingQueue.findIndex(p => p.workspaceId === workspaceId);
  if (idx >= 0) {
    const claim = pendingQueue.splice(idx, 1)[0];
    claim.resolve(sessionId);
    return true;
  }
  return false;
}

// Global listener for TerminalSessionCreated (registered once)
let globalListenerInstalled = false;
function installGlobalListener() {
  if (globalListenerInstalled) return;
  globalListenerInstalled = true;
  window.addEventListener('terminal-event', (e: Event) => {
    const event = (e as CustomEvent).detail;
    if (event.type === 'TerminalSessionCreated') {
      claimSession(event.workspace_id, event.session_id);
    }
  });
}

function getTermTheme() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim() || undefined;
  return {
    background: v('--bg-base') || '#0d1117',
    foreground: v('--text-primary') || '#e0e0e0',
    cursor: v('--accent-primary') || '#4ecdc4',
    cursorAccent: v('--bg-base') || '#0d1117',
    selectionBackground: v('--bg-overlay') || '#232738',
    selectionForeground: v('--text-primary') || '#e2e4e9',
  };
}

export function TerminalPane({ pane: _pane, workspaceId, focused }: PaneProps) {
  const send = useSend();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [xtermLoaded, setXtermLoaded] = useState(false);
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
          theme: getTermTheme(),
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 13,
          cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(termRef.current);
        fitAddon.fit();

        xtermRef.current = terminal;
        setXtermLoaded(true);

        // Send user input to daemon PTY — use ref to avoid stale closure
        terminal.onData((data: string) => {
          if (sessionIdRef.current) {
            send({ type: 'WriteTerminalInput', session_id: sessionIdRef.current, data });
          }
        });

        // Resize observer — debounced to avoid spamming stty on drag
        let resizeTimer: ReturnType<typeof setTimeout>;
        const ro = new ResizeObserver(() => {
          fitAddon.fit();
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
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
          }, 150);
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

  // Update xterm theme when CSS variables change (theme switch)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const term = xtermRef.current as any;
      if (term?.options) {
        term.options.theme = getTermTheme();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  // Focus xterm when this pane becomes focused (for keyboard navigation)
  useEffect(() => {
    if (focused && xtermRef.current) {
      (xtermRef.current as any).focus?.();
    }
  }, [focused]);

  // Create a PTY session when component mounts — uses FIFO queue for reliable matching
  useEffect(() => {
    if (sessionState !== 'idle') return;
    installGlobalListener();
    setSessionState('creating');
    send({ type: 'CreateTerminalSession', workspace_id: workspaceId });
    waitForSession(workspaceId).then((sid) => {
      setSessionId(sid);
      setSessionState('active');
    });
  }, [workspaceId, sessionState, send]);

  // Listen for terminal output and close events (session-specific, not creation)
  useEffect(() => {
    if (!sessionId) return;
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail;
      if (event.type === 'TerminalOutput' && event.session_id === sessionId) {
        xtermRef.current?.write(event.data);
      }
      if (event.type === 'TerminalSessionClosed' && event.session_id === sessionId) {
        setSessionState('lost');
      }
    };
    window.addEventListener('terminal-event', handler);
    return () => window.removeEventListener('terminal-event', handler);
  }, [sessionId]);

  // Send initial terminal dimensions once session is active and xterm is loaded
  useEffect(() => {
    if (sessionId && xtermLoaded && termRef.current) {
      const timer = setTimeout(() => {
        const term = xtermRef.current as any;
        if (term?.cols && term?.rows) {
          // Set COLUMNS/LINES silently (clear the command from view after)
          send({
            type: 'WriteTerminalInput',
            session_id: sessionId,
            data: `export COLUMNS=${term.cols} LINES=${term.rows} 2>/dev/null\nclear\n`,
          });
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [sessionId, xtermLoaded, send]);

  const handleReconnect = () => {
    setSessionState('idle');
    setSessionId(null);
  };

  return (
    <div data-pane-kind="terminal" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-base)' }}>
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
          <span style={{ color: 'var(--accent-error)', fontFamily: 'monospace', fontSize: 14 }}>
            Session lost
          </span>
          <button
            onClick={handleReconnect}
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--bg-surface)',
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
      {!xtermLoaded && sessionState !== 'lost' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
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
