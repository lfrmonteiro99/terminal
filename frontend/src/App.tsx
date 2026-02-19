import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useAppState, useAppDispatch } from './context/AppContext.tsx';
import { useWebSocket } from './hooks/useWebSocket.ts';
import { RunPanel } from './components/RunPanel.tsx';
import { DecisionPanel } from './components/DecisionPanel.tsx';
import { SessionSidebar } from './components/SessionSidebar.tsx';
import { PostRunSummary } from './components/PostRunSummary.tsx';
import { DirtyWarningModal } from './components/DirtyWarningModal.tsx';
import { StashDrawer } from './components/StashDrawer.tsx';
import type { AppEvent, RunMode, RunState } from './types/protocol.ts';

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
  const [prompt, setPrompt] = useState('');
  const [daemonUrl, setDaemonUrl] = useState(IS_TAURI ? '' : 'ws://127.0.0.1:3000/ws');
  const [authToken, setAuthToken] = useState('');
  const [projectRoot, setProjectRoot] = useState('');

  // Tauri mode: poll get_daemon_info until daemon is ready, then auto-connect
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    const poll = async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      for (let attempt = 0; attempt < 10; attempt++) {
        if (cancelled) return;
        try {
          const info = await invoke<{ port: number; token: string }>('get_daemon_info');
          setDaemonUrl(`ws://127.0.0.1:${info.port}/ws`);
          setAuthToken(info.token);
          return;
        } catch {
          await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        }
      }
      console.error('Daemon did not become ready after 10 attempts');
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  const handleEvent = useCallback(
    (event: AppEvent) => {
      dispatch({ type: 'HANDLE_EVENT', event });
    },
    [dispatch],
  );

  const { status, send } = useWebSocket({
    url: daemonUrl,
    token: authToken,
    onEvent: handleEvent,
  });

  const handleStartSession = () => {
    if (projectRoot.trim()) {
      send({ type: 'StartSession', project_root: projectRoot.trim() });
    }
  };

  const handleStartRun = () => {
    if (state.activeSession && prompt.trim()) {
      send({
        type: 'StartRun',
        session_id: state.activeSession,
        prompt: prompt.trim(),
        mode: 'Free' as RunMode,
      });
      setPrompt('');
    }
  };

  const handleRespond = (runId: string, response: string) => {
    send({ type: 'RespondToBlocking', run_id: runId, response });
  };

  const handleCancel = (runId: string) => {
    send({ type: 'CancelRun', run_id: runId, reason: 'User cancelled' });
  };

  const handleGetDiff = (runId: string) => {
    send({ type: 'GetDiff', run_id: runId });
  };

  const handleRevert = (runId: string) => {
    send({ type: 'RevertRun', run_id: runId });
  };

  const handleMerge = (runId: string) => {
    send({ type: 'MergeRun', run_id: runId });
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

  // Determine if selectedRun is in a terminal state
  const selectedRunObj = state.selectedRun ? state.runs.get(state.selectedRun) : undefined;
  const isTerminalState = (rs: RunState): boolean =>
    rs.type === 'Completed' || rs.type === 'Failed' || rs.type === 'Cancelled';
  const showPostRunSummary =
    !state.activeRun &&
    selectedRunObj !== undefined &&
    isTerminalState(selectedRunObj.state);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: '#16213e',
        color: '#e0e0e0',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 'bold' }}>Terminal Engine</span>
        <span
          style={{
            color:
              status === 'connected'
                ? '#4ecdc4'
                : status === 'connecting' || status === 'authenticating'
                  ? '#f0a500'
                  : '#ff6b6b',
          }}
        >
          {status}
        </span>
        {state.activeSession && (
          <span style={{ color: '#888' }}>
            Session: {state.activeSession.slice(0, 8)}...
          </span>
        )}
        {state.error && (
          <span style={{ color: '#ff6b6b', marginLeft: 'auto' }}>
            {state.error}
          </span>
        )}
      </div>

      {/* Connection setup (show when disconnected, browser mode only) */}
      {!IS_TAURI && status === 'disconnected' && (
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
      {IS_TAURI && status !== 'connected' && (
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
          <button onClick={handleStartSession} style={buttonStyle}>
            Start Session
          </button>
        </div>
      )}

      {/* Body: sidebar + main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar (when session active) */}
        {state.activeSession && <SessionSidebar />}

        {/* Main panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {state.activeRun ? (
            <>
              <RunPanel />
              {state.blocking && (
                <DecisionPanel
                  runId={state.activeRun}
                  question={state.blocking.question}
                  context={state.blocking.context}
                  onRespond={handleRespond}
                  onCancel={handleCancel}
                />
              )}
            </>
          ) : showPostRunSummary && state.selectedRun ? (
            <PostRunSummary
              runId={state.selectedRun}
              onGetDiff={handleGetDiff}
              onMerge={handleMerge}
              onRevert={handleRevert}
            />
          ) : (
            <>
              <RunPanel />
              {/* Prompt input (show when session active and no run in progress) */}
              {status === 'connected' && state.activeSession && (
                <div
                  style={{
                    padding: '8px 16px',
                    borderTop: '1px solid #333',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleStartRun()}
                    placeholder="Enter prompt for Claude..."
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={handleStartRun} style={buttonStyle}>
                    Run
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '4px 16px',
          borderTop: '1px solid #333',
          fontSize: 11,
          color: '#666',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
        }}
      >
        <span>Phase 2 — Multi-Run + Git</span>
        {state.runState && (
          <span>State: {state.runState.type}</span>
        )}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_STASH_DRAWER' })}
          style={{
            marginLeft: 'auto',
            backgroundColor: 'transparent',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '2px 8px',
          }}
        >
          Stashes{state.stashes.length > 0 ? ` (${state.stashes.length})` : ''}
        </button>
      </div>

      {/* Dirty Warning Modal */}
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

      {/* Stash Drawer */}
      {state.stashDrawerOpen && (
        <StashDrawer
          onClose={() => dispatch({ type: 'TOGGLE_STASH_DRAWER' })}
          onFetchStashes={() => send({ type: 'ListStashes' })}
          onFetchFiles={(index) => send({ type: 'GetStashFiles', stash_index: index })}
          onFetchDiff={(index, filePath) => send({ type: 'GetStashDiff', stash_index: index, file_path: filePath })}
        />
      )}
    </div>
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
