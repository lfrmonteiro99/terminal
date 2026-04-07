// Command palette — fast actions across all modes (M7-02)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSend } from '../context/SendContext';
import { useAppDispatch } from '../context/AppContext';
import { listModes } from '../modes/registry';

interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const send = useSend();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const modes = listModes();

  const allCommands: Command[] = useMemo(
    () => [
      // Mode switching
      ...modes.map((m) => ({
        id: `mode:${m.id}`,
        label: `Switch to ${m.label} Mode`,
        description: m.description,
        shortcut: m.shortcut,
        action: () => { onClose(); },
      })),
      // Sidebar toggles
      {
        id: 'sidebar:explorer',
        label: 'Open Explorer',
        shortcut: 'Ctrl+Shift+E',
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'explorer' }); onClose(); },
      },
      {
        id: 'sidebar:changes',
        label: 'Open Changes',
        shortcut: 'Ctrl+Shift+G',
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'changes' }); onClose(); },
      },
      {
        id: 'sidebar:git',
        label: 'Open Git History',
        shortcut: 'Ctrl+Shift+H',
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'git' }); onClose(); },
      },
      {
        id: 'git:refresh',
        label: 'Refresh Git Status',
        action: () => { send({ type: 'GetRepoStatus' }); send({ type: 'GetChangedFiles', mode: 'working' }); onClose(); },
      },
      {
        id: 'git:push',
        label: 'Push Branch',
        action: () => { send({ type: 'PushBranch' }); onClose(); },
      },
      {
        id: 'git:pull',
        label: 'Pull Branch',
        action: () => { send({ type: 'PullBranch' }); onClose(); },
      },
      {
        id: 'git:fetch',
        label: 'Fetch Remote',
        action: () => { send({ type: 'FetchRemote' }); onClose(); },
      },
      {
        id: 'workspace:list',
        label: 'List Workspaces',
        action: () => { send({ type: 'ListWorkspaces' }); onClose(); },
      },
    ],
    [modes, send, dispatch, onClose],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
    );
  }, [allCommands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { setSelectedIndex((i) => Math.max(i - 1, 0)); e.preventDefault(); return; }
    if (e.key === 'Enter') { filtered[selectedIndex]?.action(); return; }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '20vh',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          border: '1px solid #444',
          borderRadius: 8,
          width: 480,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          style={{
            padding: '12px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: '1px solid #333',
            color: '#e0e0e0',
            fontSize: 14,
            fontFamily: 'monospace',
            outline: 'none',
          }}
        />
        <div style={{ overflow: 'auto', flex: 1 }}>
          {filtered.map((cmd, idx) => (
            <div
              key={cmd.id}
              onClick={cmd.action}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                backgroundColor: idx === selectedIndex ? '#1e2a3e' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <span style={{ flex: 1, fontSize: 13, color: '#e0e0e0', fontFamily: 'monospace' }}>
                {cmd.label}
              </span>
              {cmd.shortcut && (
                <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', backgroundColor: '#111', padding: '2px 6px', borderRadius: 3 }}>
                  {cmd.shortcut}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '16px', color: '#555', fontSize: 12, fontFamily: 'monospace' }}>
              No commands found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
