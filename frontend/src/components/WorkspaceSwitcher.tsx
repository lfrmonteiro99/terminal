// WorkspaceSwitcher + ModePicker (M3-02)

import { useState } from 'react';
import { useAppState, useAppDispatch } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import { listModes } from '../modes/registry';
import type { WorkspaceMode } from '../domain/workspace/types';

export function WorkspaceSwitcher() {
  const state = useAppState();
  const send = useSend();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<WorkspaceMode>('AiSession');

  const modes = listModes();
  const workspaces = Array.from((state as any).workspaces?.values?.() ?? []);

  const handleCreate = () => {
    if (!newName.trim() || !state.activeSession) return;
    const sessions = Array.from((state as any).sessions?.values?.() ?? []);
    const session = sessions[0] as any;
    if (!session) return;
    send({
      type: 'CreateWorkspace',
      name: newName.trim(),
      root_path: session.project_root ?? '/',
      mode: newMode,
    });
    setCreating(false);
    setNewName('');
  };

  const handleActivate = (id: string) => {
    send({ type: 'ActivateWorkspace', workspace_id: id });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px',
        backgroundColor: '#1a1a2e',
        borderRight: '1px solid #333',
        width: 160,
        overflow: 'auto',
      }}
    >
      <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', padding: '0 4px', marginBottom: 4 }}>
        WORKSPACES
      </div>

      {(workspaces as any[]).map((ws: any) => (
        <div
          key={ws.id}
          onClick={() => handleActivate(ws.id)}
          style={{
            padding: '6px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            backgroundColor: (state as any).activeWorkspaceId === ws.id ? '#1e2a3e' : 'transparent',
            border: (state as any).activeWorkspaceId === ws.id ? '1px solid #4ecdc4' : '1px solid transparent',
            fontSize: 12,
            fontFamily: 'monospace',
            color: '#e0e0e0',
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{ws.name}</div>
          <div style={{ fontSize: 10, color: '#888' }}>{ws.mode}</div>
        </div>
      ))}

      {creating ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
            placeholder="Workspace name"
            autoFocus
            style={{
              backgroundColor: '#16213e',
              border: '1px solid #444',
              color: '#e0e0e0',
              padding: '4px 6px',
              borderRadius: 3,
              fontSize: 11,
              fontFamily: 'monospace',
            }}
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value as WorkspaceMode)}
            style={{
              backgroundColor: '#16213e',
              border: '1px solid #444',
              color: '#e0e0e0',
              padding: '3px 4px',
              borderRadius: 3,
              fontSize: 11,
            }}
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={handleCreate} style={{ flex: 1, backgroundColor: '#4ecdc4', color: '#1a1a2e', border: 'none', borderRadius: 3, padding: '3px', cursor: 'pointer', fontSize: 11 }}>
              Create
            </button>
            <button onClick={() => setCreating(false)} style={{ flex: 1, backgroundColor: 'transparent', color: '#888', border: '1px solid #444', borderRadius: 3, padding: '3px', cursor: 'pointer', fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          style={{
            marginTop: 4,
            background: 'none',
            border: '1px dashed #444',
            color: '#888',
            borderRadius: 4,
            padding: '6px',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          + New Workspace
        </button>
      )}
    </div>
  );
}
