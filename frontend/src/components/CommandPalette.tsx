// Command palette — fast actions across all modes (M7-02)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSend } from '../context/SendContext';
import { useAppDispatch } from '../context/AppContext';
import type { PaneLayout } from '../domain/pane/types';
import { themes, applyTheme, getCurrentThemeId } from '../styles/themes';

interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onLayoutChange?: (layout: PaneLayout) => void;
  onSplitH?: () => void;
  onSplitV?: () => void;
}

const PRESETS: Record<string, PaneLayout> = {
  terminal: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
  ai: {
    Split: {
      direction: 'Horizontal', ratio: 0.5,
      first: { Single: { id: 'ai-run', kind: 'AiRun', resource_id: null } },
      second: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
    },
  },
  git: {
    Split: {
      direction: 'Horizontal', ratio: 0.4,
      first: { Single: { id: 'git-status', kind: 'GitStatus', resource_id: null } },
      second: { Single: { id: 'git-history', kind: 'GitHistory', resource_id: null } },
    },
  },
  browser: {
    Split: {
      direction: 'Horizontal', ratio: 0.5,
      first: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
      second: { Single: { id: 'browser-0', kind: 'Browser', resource_id: null } },
    },
  },
};

export function CommandPalette({ open, onClose, onLayoutChange, onSplitH, onSplitV }: CommandPaletteProps) {
  const send = useSend();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allCommands: Command[] = useMemo(
    () => [
      // Pane layout commands
      {
        id: 'pane:split-right',
        label: 'Split Pane Right',
        description: 'Split the focused pane horizontally',
        action: () => { onSplitH?.(); },
      },
      {
        id: 'pane:split-down',
        label: 'Split Pane Down',
        description: 'Split the focused pane vertically',
        action: () => { onSplitV?.(); },
      },
      {
        id: 'layout:terminal',
        label: 'Layout: Terminal Focus',
        description: 'Single terminal pane',
        action: () => { onLayoutChange?.(PRESETS.terminal); onClose(); },
      },
      {
        id: 'layout:ai',
        label: 'Layout: AI Session',
        description: 'Terminal + AI pane side by side',
        action: () => { onLayoutChange?.(PRESETS.ai); onClose(); },
      },
      {
        id: 'layout:git',
        label: 'Layout: Git Review',
        description: 'Git status + git history side by side',
        action: () => { onLayoutChange?.(PRESETS.git); onClose(); },
      },
      {
        id: 'layout:browser',
        label: 'Layout: Browser + Terminal',
        description: 'Terminal + embedded browser side by side',
        action: () => { onLayoutChange?.(PRESETS.browser); onClose(); },
      },
      // Sidebar commands
      {
        id: 'sidebar:toggle',
        label: 'Toggle Sidebar',
        description: 'Collapse or expand the sidebar',
        shortcut: 'Ctrl+B',
        action: () => { dispatch({ type: 'TOGGLE_SIDEBAR' }); onClose(); },
      },
      {
        id: 'sidebar:explorer',
        label: 'Explorer',
        description: 'Switch sidebar to explorer view',
        shortcut: 'Ctrl+Shift+E',
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'explorer' }); onClose(); },
      },
      {
        id: 'sidebar:changes',
        label: 'Changes',
        description: 'Switch sidebar to changes view',
        shortcut: 'Ctrl+Shift+G',
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'changes' }); onClose(); },
      },
      {
        id: 'sidebar:git',
        label: 'Git',
        description: 'Switch sidebar to git view',
        shortcut: 'Ctrl+Shift+H',
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'git' }); onClose(); },
      },
      // Git operations
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
      // Theme commands
      ...themes.map(theme => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.name}`,
        description: getCurrentThemeId() === theme.id ? '● Active' : undefined,
        action: () => { applyTheme(theme.id); onClose(); },
      })),
    ],
    [send, dispatch, onClose, onLayoutChange],
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
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Defer focus to next tick so the element is mounted
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { setSelectedIndex((i) => Math.max(i - 1, 0)); e.preventDefault(); return; }
    if (e.key === 'Enter') { filtered[selectedIndex]?.action(); return; }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
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
          backgroundColor: 'var(--bg-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          width: 520,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
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
            backgroundColor: 'var(--bg-surface)',
            border: 'none',
            borderBottom: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            fontSize: 16,
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
                backgroundColor: idx === selectedIndex ? 'var(--bg-overlay)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {cmd.label}
                </span>
                {cmd.description && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {cmd.description}
                  </span>
                )}
              </div>
              {cmd.shortcut && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                  backgroundColor: 'var(--bg-base)',
                  border: '1px solid var(--border-default)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  whiteSpace: 'nowrap',
                }}>
                  {cmd.shortcut}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
              No commands found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
