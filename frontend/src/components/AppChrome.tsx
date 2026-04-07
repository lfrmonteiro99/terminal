// AppChrome — consistent header: workspace title, mode badge, connection status (M7-01)

import { useAppState, useAppDispatch } from '../context/AppContext';
import { listModes } from '../modes/registry';
import type { WorkspaceMode } from '../domain/workspace/types';

interface AppChromeProps {
  connectionStatus: string;
  onOpenCommandPalette: () => void;
}

function ModeBadge({ mode }: { mode?: WorkspaceMode }) {
  const modes = listModes();
  const def = modes.find((m) => m.id === mode);
  if (!def) return null;

  const colors: Record<WorkspaceMode, string> = {
    AiSession: '#4ecdc4',
    Terminal: '#f0a500',
    Git: '#ff6b6b',
    Browser: '#a29bfe',
  };

  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'monospace',
        padding: '2px 8px',
        borderRadius: 10,
        backgroundColor: colors[def.id] + '22',
        color: colors[def.id],
        border: `1px solid ${colors[def.id]}44`,
        fontWeight: 'bold',
      }}
    >
      {def.icon} {def.label}
    </span>
  );
}

export function AppChrome({ connectionStatus, onOpenCommandPalette }: AppChromeProps) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const activeWorkspace = (state as any).workspaces?.get?.((state as any).activeWorkspaceId);
  const workspaceName = activeWorkspace?.name ?? 'Terminal Engine';
  const workspaceMode: WorkspaceMode | undefined = activeWorkspace?.mode;

  const statusColor =
    connectionStatus === 'connected'
      ? '#4ecdc4'
      : connectionStatus === 'connecting' || connectionStatus === 'authenticating'
        ? '#f0a500'
        : '#ff6b6b';

  return (
    <div
      style={{
        padding: '6px 16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#16213e',
        fontSize: 13,
        fontFamily: 'monospace',
        flexShrink: 0,
        minHeight: 36,
      }}
    >
      {/* Workspace title */}
      <span style={{ fontWeight: 'bold', color: '#e0e0e0' }}>{workspaceName}</span>

      {/* Mode badge */}
      {workspaceMode && <ModeBadge mode={workspaceMode} />}

      {/* Session indicator */}
      {state.activeSession && (
        <span style={{ color: '#555', fontSize: 11 }}>
          sess:{state.activeSession.slice(0, 6)}
        </span>
      )}

      {/* Run state indicator */}
      {state.activeRun && (
        <span style={{ color: '#f0a500', fontSize: 11 }}>
          ● Running
        </span>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Error */}
      {state.error && (
        <span
          style={{ color: '#ff6b6b', fontSize: 11, cursor: 'pointer' }}
          onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
          title="Click to dismiss"
        >
          ⚠ {state.error}
        </span>
      )}

      {/* Command palette button */}
      <button
        onClick={onOpenCommandPalette}
        title="Command Palette (Ctrl+P)"
        style={{
          background: 'none',
          border: '1px solid #333',
          color: '#888',
          borderRadius: 4,
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        ⌘P
      </button>

      {/* Connection status dot */}
      <span style={{ color: statusColor, fontSize: 11 }}>● {connectionStatus}</span>
    </div>
  );
}
