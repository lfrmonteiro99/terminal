// TerminalPane — xterm.js terminal bound to a daemon PTY session (M4-02)
// Registers itself in the pane registry.

import 'xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { useSend } from '../../context/SendContext';
import { useAppState } from '../../context/AppContext';
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

// Global map: paneId → sessionId. Survives React remounts (e.g., after pane split).
const paneSessionMap = new Map<string, string>();

/** Minimal subset of xterm.js Terminal we use here. */
interface XTermHandle {
  write: (data: string) => void;
  dispose: () => void;
  clear?: () => void;
  focus?: () => void;
  options?: { theme?: unknown };
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

export function TerminalPane({ pane, workspaceId, focused }: PaneProps) {
  const send = useSend();
  const state = useAppState();
  const session = state.sessions.get(workspaceId);
  const cwd = session?.project_root ?? undefined;
  // Check if this pane already has a session from a previous mount (e.g., after split)
  const existingSessionId = paneSessionMap.get(pane.id) ?? null;
  const [sessionId, setSessionId] = useState<string | null>(existingSessionId);
  const [sessionState, setSessionState] = useState<SessionState>(existingSessionId ? 'active' : 'idle');
  const [xtermLoaded, setXtermLoaded] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTermHandle | null>(null);

  // Ref to hold current sessionId for use inside closures that can't track state
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Ref to track focused state inside event handler closures
  const focusedRef = useRef(focused);
  useEffect(() => { focusedRef.current = focused; }, [focused]);

  // Ref to hold current send function — avoids stale closure after reconnect
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);

  // Git command detection: accumulate recent terminal output to detect when a git
  // command completes (i.e. prompt returns after git output).
  const recentOutputRef = useRef<string>('');
  const gitRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup git refresh timer on unmount
  useEffect(() => {
    return () => {
      if (gitRefreshTimerRef.current) clearTimeout(gitRefreshTimerRef.current);
    };
  }, []);

  // Dynamically load xterm.js to keep bundle lean
  useEffect(() => {
    let disposed = false;

    const initXterm = async () => {
      try {
        const { Terminal } = await import('xterm');
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

        // Send user input to daemon PTY — use refs to avoid stale closures after reconnect
        terminal.onData((data: string) => {
          if (sessionIdRef.current) {
            sendRef.current({ type: 'WriteTerminalInput', session_id: sessionIdRef.current, data });
          }
        });

        // Resize observer — fit immediately (cheap), debounce only the stty ResizeTerminal IPC
        let resizeTimer: ReturnType<typeof setTimeout>;
        const ro = new ResizeObserver(() => {
          fitAddon.fit();
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            if (sessionIdRef.current) {
              const dims = fitAddon.proposeDimensions();
              if (dims) {
                sendRef.current({
                  type: 'ResizeTerminal',
                  session_id: sessionIdRef.current,
                  cols: dims.cols,
                  rows: dims.rows,
                });
              }
            }
          }, 80);
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
      const term = xtermRef.current;
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
      xtermRef.current.focus?.();
    }
  }, [focused]);

  // Parse SSH config from resource_id (format: ssh://user@host:port?identity=/path)
  const sshConfig = (() => {
    const rid = pane.resource_id;
    if (typeof rid !== 'string' || !rid.startsWith('ssh://')) return undefined;
    try {
      // ssh://username@host:port or ssh://username@host:port?identity=/path/to/key
      const url = new URL(rid);
      return {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : 22,
        username: url.username || 'root',
        identity_file: url.searchParams.get('identity') || undefined,
      };
    } catch {
      return undefined;
    }
  })();

  // Create a PTY session when component mounts — uses FIFO queue for reliable matching
  useEffect(() => {
    if (sessionState !== 'idle') return;
    installGlobalListener();
    setSessionState('creating');
    const cmd: Record<string, unknown> = {
      type: 'CreateTerminalSession',
      workspace_id: workspaceId,
      cwd,
    };
    if (sshConfig) {
      cmd.ssh = sshConfig;
    }
    // cmd is structurally an AppCommand for CreateTerminalSession — the
    // optional `ssh` field isn't on every variant, hence the unknown cast.
    send(cmd as unknown as Parameters<typeof send>[0]);
    waitForSession(workspaceId).then((sid) => {
      paneSessionMap.set(pane.id, sid);
      setSessionId(sid);
      setSessionState('active');
    });
  }, [workspaceId, sessionState, send]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for terminal output and close events (session-specific, not creation)
  useEffect(() => {
    if (!sessionId) return;
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail;
      if (event.type === 'TerminalOutput' && event.session_id === sessionId) {
        xtermRef.current?.write(event.data);

        // Accumulate recent output for git command detection (bounded at 2KB)
        recentOutputRef.current += event.data;
        if (recentOutputRef.current.length > 2048) {
          recentOutputRef.current = recentOutputRef.current.slice(-2048);
        }

        // Detect a shell prompt return after a git command.
        // The git pattern must appear as a command (after a prompt character),
        // not merely in output text — we check for a prompt prefix before "git".
        const gitCmdPattern = /(?:^|[$%>❯]\s+)git\s+(?:add|commit|checkout|switch|merge|rebase|stash|pull|push|reset|revert|cherry-pick|branch|restore|rm|mv|tag)\b/m;
        // A prompt appearing at the end of the latest chunk signals command completion
        const promptReturnPattern = /[$%>❯]\s*$/;

        if (
          gitCmdPattern.test(recentOutputRef.current) &&
          // eslint-disable-next-line no-control-regex
          promptReturnPattern.test(event.data.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').trimEnd())
        ) {
          if (gitRefreshTimerRef.current) clearTimeout(gitRefreshTimerRef.current);
          gitRefreshTimerRef.current = setTimeout(() => {
            window.dispatchEvent(new CustomEvent('git-auto-refresh'));
            recentOutputRef.current = '';
          }, 500);
        }

        // Notify user when prompt returns in an unfocused pane
        // eslint-disable-next-line no-control-regex
        if (!focusedRef.current && promptReturnPattern.test(event.data.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').trimEnd())) {
          const notificationsEnabled = localStorage.getItem('terminal:notifications') !== 'false';
          if (notificationsEnabled) {
            window.dispatchEvent(new CustomEvent('terminal-notification', {
              detail: {
                paneId: pane.id,
                paneLabel: pane.label ?? 'Terminal',
                message: 'Command completed',
              },
            }));
          }
        }
      }
      if (event.type === 'TerminalSessionClosed' && event.session_id === sessionId) {
        paneSessionMap.delete(pane.id);
        setSessionState('lost');
      }
    };
    window.addEventListener('terminal-event', handler);
    return () => window.removeEventListener('terminal-event', handler);
    // pane.id and pane.label are stable per component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Listen for quick-command run events — only the focused pane handles them
  useEffect(() => {
    const handler = (e: Event) => {
      const { data } = (e as CustomEvent<{ data: string }>).detail;
      if (focusedRef.current && sessionIdRef.current) {
        sendRef.current({ type: 'WriteTerminalInput', session_id: sessionIdRef.current, data });
      }
    };
    window.addEventListener('write-to-terminal', handler);
    return () => window.removeEventListener('write-to-terminal', handler);
  }, []);

  // Clear the xterm viewport once session is active and xterm is loaded
  // Use xterm's own clear API rather than sending 'clear\n' to the PTY
  // (avoids polluting shell history and the visible clear command flicker)
  useEffect(() => {
    if (sessionId && xtermLoaded) {
      const timer = setTimeout(() => {
        const term = xtermRef.current;
        if (term) {
          // Clear xterm screen
          if (term.clear) term.clear();
          else if (term.write) term.write('\x1b[2J\x1b[H');
          // Show a small teal banner above the first prompt — only for local shells.
          // Suppressed for SSH to avoid clobbering the remote MOTD. Respects opt-out.
          const bannerEnabled = localStorage.getItem('terminal:banner') !== 'false';
          if (bannerEnabled && !sshConfig && term.write) {
            // ANSI: 38;2;R;G;B sets 24-bit fg color. Teal = 78,205,196.
            const teal = '\x1b[38;2;78;205;196m';
            const dim = '\x1b[38;2;139;143;163m';
            const reset = '\x1b[0m';
            const banner =
              `${teal} ▸ Terminal Engine${reset}${dim}  ready${reset}\r\n` +
              `${dim} ⌘K commands · ⌘/ shortcuts${reset}\r\n\r\n`;
            term.write(banner);
          }
          // Send Enter to PTY to trigger a fresh prompt
          sendRef.current({ type: 'WriteTerminalInput', session_id: sessionId, data: '\n' });
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [sessionId, xtermLoaded, sshConfig]);

  const handleReconnect = () => {
    paneSessionMap.delete(pane.id);
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
          <span
            style={{
              color: 'var(--accent-error)',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: '0.01em',
            }}
          >
            session lost
          </span>
          <button
            onClick={handleReconnect}
            style={{
              padding: '8px 18px',
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--bg-base)',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.02em',
              boxShadow: 'var(--glow-accent)',
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
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            letterSpacing: '0.01em',
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
          <span>
            {sessionState === 'creating'
              ? (sshConfig ? `connecting to ${sshConfig.username}@${sshConfig.host}...` : 'starting terminal...')
              : 'terminal'}
          </span>
        </div>
      )}
    </div>
  );
}

registerPane('Terminal', TerminalPane);
