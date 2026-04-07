import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useAppState, useAppDispatch } from './context/AppContext.tsx';
import { SendProvider } from './context/SendContext.tsx';
import { useWebSocket } from './hooks/useWebSocket.ts';
import { ActivityBar } from './components/ActivityBar.tsx';
import { SidebarContainer } from './components/sidebar/SidebarContainer.tsx';
import { DirtyWarningModal } from './components/DirtyWarningModal.tsx';
import { StashDrawer } from './components/StashDrawer.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { AppChrome } from './components/AppChrome';
import { CommandPalette } from './components/CommandPalette';
import { PaneRenderer } from './panes/PaneRenderer';
import type { PaneLayout } from './domain/pane/types';
import type { AppEvent } from './types/protocol.ts';
import { saveWorkspaceLayout, loadWorkspaceLayout } from './state/layout-persistence';

// Side-effect imports: register panes and modes
import './panes/terminal/TerminalPane';
import './panes/ai-run/AiRunPane';
import './modes/definitions';

const inputStyle: React.CSSProperties = {
  padding: 8,
  fontFamily: 'monospace',
  fontSize: 13,
  backgroundColor: '#1a1a2e',
  color: '#e0e0e0',
  border: '1px solid #444',
  borderRadius: 4,
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#4ecdc4',
  color: '#1a1a2e',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 'bold',
  fontFamily: 'monospace',
};

function AppContent() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [daemonUrl, setDaemonUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [projectRoot, setProjectRoot] = useState('');
  const [tauriMode, setTauriMode] = useState<boolean | null>(null); // null = unknown yet

  // Pane layout state
  const [layout, setLayout] = useState<PaneLayout>(() => ({
    Single: { id: 'terminal-0', kind: 'Terminal' as const, resource_id: null },
  }));
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>('terminal-0');

  // Persist layout on every change
  useEffect(() => {
    if (state.activeSession) {
      saveWorkspaceLayout({
        id: state.activeSession,
        name: 'default',
        rootPath: projectRoot,
        mode: 'Terminal',
        layout,
        focusedPaneId,
        savedAt: new Date().toISOString(),
      });
    }
  }, [layout, focusedPaneId, state.activeSession, projectRoot]);

  // Restore layout when a session becomes active
  useEffect(() => {
    if (state.activeSession) {
      const saved = loadWorkspaceLayout(state.activeSession);
      if (saved) {
        setLayout(saved.layout);
        if (saved.focusedPaneId) setFocusedPaneId(saved.focusedPaneId);
      }
    }
  }, [state.activeSession]);

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // On mount: detect Tauri via dynamic import probe, then auto-connect or fall back
  useEffect(() => {
    let cancelled = false;

    const detectAndConnect = async () => {
      // Check for Tauri runtime (injected by the native shell, not present in browsers)
      if (!(window as any).__TAURI_INTERNALS__) {
        console.log('[Browser] Tauri runtime not detected, using standalone mode');
        setDaemonUrl('ws://127.0.0.1:3000/ws');
        setTauriMode(false);
        return;
      }

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        console.log('[Tauri] API module resolved, polling for daemon...');

        for (let attempt = 0; attempt < 15; attempt++) {
          if (cancelled) return;
          try {
            const info = await invoke<{ port: number; token: string }>('get_daemon_info');
            console.log('[Tauri] Daemon ready on port', info.port);
            setDaemonUrl(`ws://127.0.0.1:${info.port}/ws`);
            setAuthToken(info.token);
            setTauriMode(true);
            return;
          } catch (e) {
            console.log(`[Tauri] Attempt ${attempt + 1} failed:`, e);
            await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
          }
        }
        console.error('[Tauri] Daemon did not become ready after 15 attempts');
        setTauriMode(true);
      } catch {
        console.log('[Browser] Tauri API import failed, using standalone mode');
        setDaemonUrl('ws://127.0.0.1:3000/ws');
        setTauriMode(false);
      }
    };

    detectAndConnect();
    return () => { cancelled = true; };
  }, []);

  const handleEvent = useCallback(
    (event: AppEvent) => {
      dispatch({ type: 'HANDLE_EVENT', event });

      // Route terminal events via CustomEvent (high-frequency, shouldn't go through React state)
      if (event.type === 'TerminalSessionCreated' ||
          event.type === 'TerminalOutput' ||
          event.type === 'TerminalSessionClosed') {
        window.dispatchEvent(new CustomEvent('terminal-event', { detail: event }));
      }
    },
    [dispatch],
  );

  const { status, send } = useWebSocket({
    url: daemonUrl,
    token: authToken,
    onEvent: handleEvent,
  });

  const handleBrowse = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, title: 'Select project root' });
    if (typeof selected === 'string') {
      setProjectRoot(selected);
    }
  };

  const handleStartSession = () => {
    if (projectRoot.trim()) {
      send({ type: 'StartSession', project_root: projectRoot.trim() });
    }
  };

  // Track previous activeSession to detect transitions from null -> value
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.activeSession && prevSessionRef.current !== state.activeSession) {
      send({ type: 'ListRuns', session_id: state.activeSession });
      send({ type: 'ListStashes' });
    }
    prevSessionRef.current = state.activeSession;
  }, [state.activeSession, send]);

  // Keyboard shortcuts for sidebar and command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
        return;
      }
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        dispatch({ type: 'TOGGLE_SIDEBAR' });
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'explorer' });
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'changes' });
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'git' });
      }
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_DIFF' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  return (
    <SendProvider value={send}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: 'var(--bg-base)',
        }}
      >
        {/* Connection setup (show when disconnected, browser mode only) */}
        {!tauriMode && status === 'disconnected' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 500 }}>
            <input
              value={daemonUrl}
              onChange={(e) => setDaemonUrl(e.target.value)}
              placeholder="Daemon WebSocket URL"
              style={inputStyle}
            />
            <input
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Auth token (from ~/.terminal-daemon/auth_token)"
              style={inputStyle}
            />
          </div>
        )}

        {/* Tauri mode: show connecting status */}
        {tauriMode && status !== 'connected' && (
          <div style={{ padding: 16, color: '#f0a500', fontFamily: 'monospace', fontSize: 13 }}>
            Connecting to embedded daemon...
          </div>
        )}

        {/* Session setup (show when connected but no session) */}
        {status === 'connected' && !state.activeSession && (
          <div style={{ padding: 16, display: 'flex', gap: 8, maxWidth: 600 }}>
            <input
              value={projectRoot}
              onChange={(e) => setProjectRoot(e.target.value)}
              placeholder="Project root path (e.g. /home/user/myproject)"
              style={{ ...inputStyle, flex: 1 }}
              onKeyDown={(e) => e.key === 'Enter' && handleStartSession()}
            />
            {tauriMode && (
              <button onClick={handleBrowse} style={buttonStyle}>
                Browse
              </button>
            )}
            <button onClick={handleStartSession} style={buttonStyle}>
              Start Session
            </button>
          </div>
        )}

        {/* Main layout (when session is active) */}
        {state.activeSession && (
          <>
            {/* AppChrome header */}
            <AppChrome />

            {/* Main content: activity bar + sidebar + pane area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <ActivityBar />
              <SidebarContainer />
              <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-surface)' }}>
                <PaneRenderer
                  layout={layout}
                  workspaceId={state.activeSession ?? ''}
                  focusedPaneId={focusedPaneId}
                  onFocusPane={setFocusedPaneId}
                  onLayoutChange={setLayout}
                />
              </div>
            </div>

            <StatusBar />
          </>
        )}

        {/* Modals */}
        {state.dirtyWarning && (
          <DirtyWarningModal
            status={state.dirtyWarning.status}
            onStashAndRun={() => {
              const dw = state.dirtyWarning!;
              send({
                type: 'StashAndRun',
                session_id: dw.session_id,
                prompt: dw.prompt,
                mode: dw.mode,
                stash_message: 'auto-stash before AI run',
              });
              dispatch({ type: 'DISMISS_DIRTY_WARNING' });
            }}
            onRunAnyway={() => {
              const dw = state.dirtyWarning!;
              send({
                type: 'StartRun',
                session_id: dw.session_id,
                prompt: dw.prompt,
                mode: dw.mode,
                skip_dirty_check: true,
              });
              dispatch({ type: 'DISMISS_DIRTY_WARNING' });
            }}
            onCancel={() => {
              dispatch({ type: 'DISMISS_DIRTY_WARNING' });
            }}
          />
        )}

        {state.stashDrawerOpen && (
          <StashDrawer
            onClose={() => dispatch({ type: 'TOGGLE_STASH_DRAWER' })}
            onFetchStashes={() => send({ type: 'ListStashes' })}
            onFetchFiles={(index) => send({ type: 'GetStashFiles', stash_index: index })}
            onFetchDiff={(index, filePath) => send({ type: 'GetStashDiff', stash_index: index, file_path: filePath })}
          />
        )}
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onLayoutChange={(newLayout) => { setLayout(newLayout); setCommandPaletteOpen(false); }}
      />
    </SendProvider>
  );
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
