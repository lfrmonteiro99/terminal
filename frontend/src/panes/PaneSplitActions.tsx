// Pane split actions toolbar (M4-04)
// Provides buttons/shortcuts to add terminal panes in split layouts.

import { useCallback, useEffect } from 'react';
import { useSend } from '../context/SendContext';

interface PaneSplitActionsProps {
  workspaceId: string;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onClosePane: () => void;
}

export function PaneSplitActions({
  workspaceId,
  onSplitHorizontal,
  onSplitVertical,
  onClosePane,
}: PaneSplitActionsProps) {
  const send = useSend();

  const addTerminal = useCallback(() => {
    send({ type: 'CreateTerminalSession', workspace_id: workspaceId });
  }, [send, workspaceId]);

  // Keyboard shortcuts for pane management (M4-05)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+\ — split horizontal
      if (e.ctrlKey && e.shiftKey && e.key === '\\') {
        e.preventDefault();
        onSplitHorizontal();
      }
      // Ctrl+Shift+- — split vertical
      if (e.ctrlKey && e.shiftKey && e.key === '-') {
        e.preventDefault();
        onSplitVertical();
      }
      // Ctrl+Shift+T — new terminal
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        addTerminal();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSplitHorizontal, onSplitVertical, addTerminal]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: '2px 8px',
        borderTop: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <ActionButton onClick={onSplitHorizontal} title="Split Right (Ctrl+Shift+\\)" label="⊢" />
      <ActionButton onClick={onSplitVertical} title="Split Down (Ctrl+Shift+-)" label="⊤" />
      <ActionButton onClick={addTerminal} title="New Terminal (Ctrl+Shift+T)" label="+⊟" />
      <div style={{ flex: 1 }} />
      <ActionButton onClick={onClosePane} title="Close Pane" label="✕" danger />
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  label,
  danger = false,
}: {
  onClick: () => void;
  title: string;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'none',
        border: '1px solid var(--border-default)',
        color: danger ? 'var(--accent-error)' : 'var(--text-muted)',
        borderRadius: 3,
        padding: '1px 6px',
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: 'monospace',
      }}
    >
      {label}
    </button>
  );
}
