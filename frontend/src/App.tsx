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
import { DiffPanel } from './components/DiffPanel';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutCheatsheet } from './components/ShortcutCheatsheet';
import { PaneRenderer } from './panes/PaneRenderer';
import type { PaneLayout, SplitDirection, PaneKind } from './domain/pane/types';
import { splitPane, closePane, collectPanes } from './domain/pane/types';
import { LAYOUT_PRESETS } from './core/layoutPresets';
import type { AppEvent } from './types/protocol.ts';
import { saveWorkspaceLayout, loadWorkspaceLayout } from './state/layout-persistence';
import { saveSession, getSession } from './state/sessionStore';
import { getCurrentThemeId, applyTheme } from './styles/themes';
import { WelcomeScreen } from './components/WelcomeScreen';

// Side-effect imports: register panes and modes
import './panes/terminal/TerminalPane';
import './panes/ai-run/AiRunPane';
import './panes/git/GitStatusPane';
import './panes/git/GitHistoryPane';
import './panes/git/MergeConflictPane';
import './panes/browser/BrowserPane';
import './panes/empty/EmptyPane';
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

function AppContent() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [daemonUrl, setDaemonUrl] = useState(() => localStorage.getItem('terminal:daemonUrl') || '');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('terminal:authToken') || '');
  const [projectRoot, setProjectRoot] = useState(() => localStorage.getItem('terminal:projectRoot') || '');
  const [tauriMode, setTauriMode] = useState<boolean | null>(null); // null = unknown yet

  // Persist connection settings across page refreshes
  useEffect(() => { if (daemonUrl) localStorage.setItem('terminal:daemonUrl', daemonUrl); }, [daemonUrl]);
  useEffect(() => { if (authToken) localStorage.setItem('terminal:authToken', authToken); }, [authToken]);
  useEffect(() => { if (projectRoot) localStorage.setItem('terminal:projectRoot', projectRoot); }, [projectRoot]);

  // Pane layout state
  const [layout, setLayout] = useState<PaneLayout>(() => ({
    Single: { id: 'terminal-0', kind: 'Terminal' as const, resource_id: null },
  }));
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>('terminal-0');
  const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null);

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

  // Restore layout when a session becomes active (or reset to default)
  useEffect(() => {
    if (state.activeSession) {
      // First try session-store (keyed by projectRoot) to restore cross-session preferences
      const sessionSaved = projectRoot ? getSession(projectRoot) : null;
      const workspaceSaved = loadWorkspaceLayout(state.activeSession);

      if (sessionSaved) {
        setLayout(sessionSaved.layout);
        setFocusedPaneId(collectPanes(sessionSaved.layout)[0]?.id ?? null);
        applyTheme(sessionSaved.theme);
        dispatch({ type: 'SET_SIDEBAR_VIEW', view: sessionSaved.sidebarView });
        if (sessionSaved.sidebarCollapsed) dispatch({ type: 'TOGGLE_SIDEBAR' });
      } else if (workspaceSaved) {
        setLayout(workspaceSaved.layout);
        setFocusedPaneId(workspaceSaved.focusedPaneId ?? collectPanes(workspaceSaved.layout)[0]?.id ?? null);
      } else {
        // New session — reset to default single terminal pane
        const defaultLayout: PaneLayout = { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } };
        setLayout(defaultLayout);
        setFocusedPaneId('terminal-0');
      }
    }
  }, [state.activeSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist session preferences whenever layout/sidebar changes while a session is active
  useEffect(() => {
    if (state.activeSession && projectRoot) {
      saveSession({
        projectRoot,
        name: projectRoot.split('/').filter(Boolean).pop() || projectRoot,
        lastUsed: new Date().toISOString(),
        layout,
        theme: getCurrentThemeId(),
        sidebarView: state.activeSidebarView,
        sidebarCollapsed: state.sidebarCollapsed,
      });
    }
  }, [state.activeSession, layout, projectRoot, state.activeSidebarView, state.sidebarCollapsed]);

  // Layout mutation handlers
  const handleSplitPane = useCallback((direction: SplitDirection, kind: PaneKind = 'Terminal') => {
    // Use focused pane, or fall back to first pane in layout
    const targetId = focusedPaneId ?? collectPanes(layout)[0]?.id;
    if (!targetId) return;
    const result = splitPane(layout, targetId, direction, kind);
    if (result) {
      setLayout(result.layout);
      setFocusedPaneId(result.newPaneId);
    }
  }, [layout, focusedPaneId]);

  const handleClosePane = useCallback((paneId: string) => {
    const result = closePane(layout, paneId);
    if (result) {
      setLayout(result);
      if (paneId === focusedPaneId) {
        const panes = collectPanes(result);
        setFocusedPaneId(panes.length > 0 ? panes[0].id : null);
      }
    } else {
      // Last pane closed — replace with Empty pane
      const emptyLayout: PaneLayout = { Single: { id: `empty-${Date.now()}`, kind: 'Empty', resource_id: null } };
      setLayout(emptyLayout);
      setFocusedPaneId(emptyLayout.Single.id);
    }
  }, [layout, focusedPaneId]);

  // Listen for set-pane-type events from EmptyPane
  useEffect(() => {
    const handler = (e: Event) => {
      const { paneId, kind } = (e as CustomEvent).detail;
      // Replace the Empty pane with the chosen kind
      setLayout(prev => {
        const replace = (l: PaneLayout): PaneLayout => {
          if ('Single' in l && l.Single.id === paneId) {
            return { Single: { ...l.Single, kind, id: `${kind.toLowerCase()}-${Date.now()}` } };
          }
          if ('Split' in l) {
            return { Split: { ...l.Split, first: replace(l.Split.first), second: replace(l.Split.second) } };
          }
          return l;
        };
        return replace(prev);
      });
    };
    window.addEventListener('set-pane-type', handler);
    return () => window.removeEventListener('set-pane-type', handler);
  }, []);

  // Listen for focus-pane-kind events from StatusBar AI running click
  useEffect(() => {
    const handler = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      const panes = collectPanes(layout);
      const target = panes.find(p => p.kind === kind);
      if (target) setFocusedPaneId(target.id);
    };
    window.addEventListener('focus-pane-kind', handler);
    return () => window.removeEventListener('focus-pane-kind', handler);
  }, [layout]);

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Cheatsheet overlay state
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

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
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setCheatsheetOpen(prev => !prev);
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
        if (cheatsheetOpen) { setCheatsheetOpen(false); return; }
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
        } else {
          dispatch({ type: 'CLOSE_DIFF' });
        }
        return;
      }
      // Alt+Arrow: navigate between panes
      if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const panes = collectPanes(layout);
        if (panes.length < 2) return;
        const currentIdx = panes.findIndex(p => p.id === focusedPaneId);
        let nextIdx: number;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIdx = (currentIdx + 1) % panes.length;
        } else {
          nextIdx = (currentIdx - 1 + panes.length) % panes.length;
        }
        setFocusedPaneId(panes[nextIdx].id);
        return;
      }
      // Ctrl+1..9: jump to pane by index (like tmux)
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const panes = collectPanes(layout);
        const idx = parseInt(e.key) - 1;
        if (idx < panes.length) setFocusedPaneId(panes[idx].id);
        return;
      }
      // Ctrl+Alt+1..4: layout presets
      if (e.ctrlKey && e.altKey && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const presetKeys = Object.keys(LAYOUT_PRESETS);
        const idx = parseInt(e.key) - 1;
        if (idx < presetKeys.length) {
          const newLayout = LAYOUT_PRESETS[presetKeys[idx]].layout;
          setLayout(newLayout);
          setFocusedPaneId(collectPanes(newLayout)[0]?.id ?? null);
        }
        return;
      }
      // Ctrl+Shift+R: refresh git
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        send({ type: 'GetRepoStatus' });
        send({ type: 'GetChangedFiles', mode: 'working' });
        return;
      }
      // Ctrl+Shift+Z: zoom/restore focused pane
      if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
        e.preventDefault();
        setZoomedPaneId(prev => prev ? null : focusedPaneId);
        return;
      }
      // Ctrl+Shift+\ : Split right, Ctrl+Shift+- : Split down
      if (e.ctrlKey && e.shiftKey && e.key === '|') {
        e.preventDefault();
        handleSplitPane('Horizontal');
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key === '_') {
        e.preventDefault();
        handleSplitPane('Vertical');
        return;
      }
    };
    // Use capture phase to intercept shortcuts before xterm.js consumes them
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [dispatch, commandPaletteOpen, cheatsheetOpen, layout, focusedPaneId, handleSplitPane]);

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
          <WelcomeScreen
            tauriMode={tauriMode ?? false}
            onBrowse={tauriMode ? async () => {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({ directory: true, title: 'Select project root' });
              return typeof selected === 'string' ? selected : null;
            } : undefined}
            onOpenSession={(root) => {
              setProjectRoot(root);
              send({ type: 'StartSession', project_root: root });
            }}
            onNewSession={(root) => {
              setProjectRoot(root);
              send({ type: 'StartSession', project_root: root });
            }}
          />
        )}

        {/* Main layout (when session is active) */}
        {state.activeSession && (
          <>
            {/* AppChrome header */}
            <AppChrome />

            {/* Main content: activity bar + sidebar + pane area */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <ActivityBar onLayoutPreset={(preset) => {
                const p = LAYOUT_PRESETS[preset];
                if (p) {
                  setLayout(p.layout);
                  setFocusedPaneId(collectPanes(p.layout)[0]?.id ?? null);
                }
              }} />
              <SidebarContainer />
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', background: 'var(--bg-surface)' }}>
                <PaneRenderer
                  layout={layout}
                  workspaceId={state.activeSession ?? ''}
                  focusedPaneId={focusedPaneId}
                  zoomedPaneId={zoomedPaneId}
                  onFocusPane={setFocusedPaneId}
                  onLayoutChange={setLayout}
                  onSplitPane={(paneId, direction) => {
                    const result = splitPane(layout, paneId, direction);
                    if (result) {
                      setLayout(result.layout);
                      setFocusedPaneId(result.newPaneId);
                    }
                  }}
                  onClosePane={handleClosePane}
                />
              </div>
            </div>

            <StatusBar />
          </>
        )}

        {/* DiffPanel overlay — outside activeSession block so it isn't unmounted on re-renders */}
        {state.diffPanel.open && state.diffPanel.mode !== 'inline' && (
          <DiffPanel />
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
        onLayoutChange={(newLayout) => {
          setLayout(newLayout);
          setFocusedPaneId(collectPanes(newLayout)[0]?.id ?? null);
          setCommandPaletteOpen(false);
        }}
        onSplitH={() => { handleSplitPane('Horizontal'); setCommandPaletteOpen(false); }}
        onSplitV={() => { handleSplitPane('Vertical'); setCommandPaletteOpen(false); }}
        onAddPane={(kind, direction) => { handleSplitPane(direction, kind as PaneKind); setCommandPaletteOpen(false); }}
        zoomedPaneId={zoomedPaneId}
        onZoomPane={() => { setZoomedPaneId(prev => prev ? null : focusedPaneId); setCommandPaletteOpen(false); }}
        onShowShortcuts={() => { setCheatsheetOpen(true); setCommandPaletteOpen(false); }}
      />

      <ShortcutCheatsheet
        open={cheatsheetOpen}
        onClose={() => setCheatsheetOpen(false)}
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
