import { useCallback, useState } from 'react';
import { AppProvider, useAppState, useAppDispatch } from './context/AppContext';
import { useWebSocket } from './hooks/useWebSocket';
import { RunPanel } from './components/RunPanel';
import { DecisionPanel } from './components/DecisionPanel';
import type { AppEvent, RunMode } from './types/protocol';

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
  const [daemonUrl, setDaemonUrl] = useState('ws://127.0.0.1:3000/ws');
  const [authToken, setAuthToken] = useState('');
  const [projectRoot, setProjectRoot] = useState('');

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

      {/* Connection setup (show when disconnected) */}
      {status === 'disconnected' && (
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

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RunPanel />

        {state.blocking && state.activeRun && (
          <DecisionPanel
            runId={state.activeRun}
            question={state.blocking.question}
            context={state.blocking.context}
            onRespond={handleRespond}
            onCancel={handleCancel}
          />
        )}
      </div>

      {/* Prompt input (show when session active and no run in progress) */}
      {status === 'connected' && state.activeSession && !state.activeRun && (
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

      {/* Footer */}
      <div
        style={{
          padding: '4px 16px',
          borderTop: '1px solid #333',
          fontSize: 11,
          color: '#666',
          display: 'flex',
          gap: 16,
        }}
      >
        <span>Phase 1 — Blocking Detection</span>
        {state.runState && (
          <span>State: {state.runState.type}</span>
        )}
      </div>
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
