// Command palette — fast actions across all modes (M7-02)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSend } from '../context/SendContext';
import { useAppDispatch } from '../context/AppContext';
import type { PaneLayout } from '../domain/pane/types';
import { themes, applyTheme, getCurrentThemeId } from '../styles/themes';
import { getShortcut, resetShortcuts } from '../core/shortcutMap';
import { LAYOUT_PRESETS } from '../core/layoutPresets';

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
  onAddPane?: (kind: string, direction: 'Horizontal' | 'Vertical') => void;
  zoomedPaneId?: string | null;
  onZoomPane?: () => void;
}

// Use shared presets — map to PaneLayout for backward compat
const PRESETS: Record<string, PaneLayout> = Object.fromEntries(
  Object.entries(LAYOUT_PRESETS).map(([k, v]) => [k, v.layout])
);

export function CommandPalette({ open, onClose, onLayoutChange, onSplitH, onSplitV, onAddPane, zoomedPaneId, onZoomPane }: CommandPaletteProps) {
  const send = useSend();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allCommands: Command[] = useMemo(
    () => [
      // Pane layout commands
      {
        id: 'pane:zoom',
        label: zoomedPaneId ? 'Restore Panes' : 'Zoom Pane',
        description: zoomedPaneId ? 'Restore split layout' : 'Maximize focused pane (hide others)',
        shortcut: 'Ctrl+Shift+Z',
        action: () => { onZoomPane?.(); },
      },
      {
        id: 'pane:split-right',
        label: 'Split Pane Right',
        description: 'Split the focused pane horizontally',
        shortcut: getShortcut('pane:split-right'),
        action: () => { onSplitH?.(); },
      },
      {
        id: 'pane:split-down',
        label: 'Split Pane Down',
        description: 'Split the focused pane vertically',
        shortcut: getShortcut('pane:split-down'),
        action: () => { onSplitV?.(); },
      },
      {
        id: 'layout:terminal',
        label: 'Layout: Terminal Focus',
        description: 'Single terminal pane',
        shortcut: getShortcut('layout:terminal'),
        action: () => { onLayoutChange?.(PRESETS.terminal); onClose(); },
      },
      {
        id: 'layout:ai',
        label: 'Layout: AI Session',
        description: 'Terminal + AI pane side by side',
        shortcut: getShortcut('layout:ai'),
        action: () => { onLayoutChange?.(PRESETS.ai); onClose(); },
      },
      {
        id: 'layout:git',
        label: 'Layout: Git Review',
        description: 'Git status + git history side by side',
        shortcut: getShortcut('layout:git'),
        action: () => { onLayoutChange?.(PRESETS.git); onClose(); },
      },
      {
        id: 'layout:browser',
        label: 'Layout: Browser + Terminal',
        description: 'Terminal + embedded browser side by side',
        shortcut: getShortcut('layout:browser'),
        action: () => { onLayoutChange?.(PRESETS.browser); onClose(); },
      },
      // Sidebar commands
      {
        id: 'sidebar:toggle',
        label: 'Toggle Sidebar',
        description: 'Collapse or expand the sidebar',
        shortcut: getShortcut('sidebar:toggle'),
        action: () => { dispatch({ type: 'TOGGLE_SIDEBAR' }); onClose(); },
      },
      {
        id: 'sidebar:explorer',
        label: 'Explorer',
        description: 'Switch sidebar to explorer view',
        shortcut: getShortcut('sidebar:explorer'),
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'explorer' }); onClose(); },
      },
      {
        id: 'sidebar:changes',
        label: 'Changes',
        description: 'Switch sidebar to changes view',
        shortcut: getShortcut('sidebar:changes'),
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'changes' }); onClose(); },
      },
      {
        id: 'sidebar:git',
        label: 'Git',
        description: 'Switch sidebar to git view',
        shortcut: getShortcut('sidebar:git'),
        action: () => { dispatch({ type: 'SET_SIDEBAR_VIEW', view: 'git' }); onClose(); },
      },
      // Git operations
      {
        id: 'git:refresh',
        label: 'Refresh Git Status',
        shortcut: getShortcut('git:refresh'),
        action: () => { send({ type: 'GetRepoStatus' }); send({ type: 'GetChangedFiles', mode: 'working' }); onClose(); },
      },
      {
        id: 'git:push',
        label: 'Push Branch',
        shortcut: getShortcut('git:push'),
        action: () => { send({ type: 'PushBranch' }); onClose(); },
      },
      {
        id: 'git:pull',
        label: 'Pull Branch',
        shortcut: getShortcut('git:pull'),
        action: () => { send({ type: 'PullBranch' }); onClose(); },
      },
      {
        id: 'git:fetch',
        label: 'Fetch Remote',
        shortcut: getShortcut('git:fetch'),
        action: () => { send({ type: 'FetchRemote' }); onClose(); },
      },
      {
        id: 'workspace:list',
        label: 'List Workspaces',
        shortcut: getShortcut('workspace:list'),
        action: () => { send({ type: 'ListWorkspaces' }); onClose(); },
      },
      // Keybinding management
      {
        id: 'keybindings:reset',
        label: 'Reset All Keybindings',
        description: 'Restore default keyboard shortcuts',
        action: () => { resetShortcuts(); onClose(); },
      },
      // Add pane commands
      { id: 'add:terminal', label: 'Add Pane: Terminal', description: 'Add a terminal pane to the right', action: () => { onAddPane?.('Terminal', 'Horizontal'); } },
      { id: 'add:terminal:down', label: 'Add Pane: Terminal (below)', description: 'Add a terminal pane below', action: () => { onAddPane?.('Terminal', 'Vertical'); } },
      { id: 'add:ai', label: 'Add Pane: AI Run', description: 'Add an AI prompt pane', action: () => { onAddPane?.('AiRun', 'Horizontal'); } },
      { id: 'add:browser', label: 'Add Pane: Browser', description: 'Add a browser pane', action: () => { onAddPane?.('Browser', 'Horizontal'); } },
      { id: 'add:gitstatus', label: 'Add Pane: Git Status', description: 'Add a git status pane', action: () => { onAddPane?.('GitStatus', 'Horizontal'); } },
      { id: 'add:githistory', label: 'Add Pane: Git History', description: 'Add a git history pane', action: () => { onAddPane?.('GitHistory', 'Horizontal'); } },
      { id: 'add:empty', label: 'Add Pane: Empty', description: 'Add an empty pane and choose type', action: () => { onAddPane?.('Empty', 'Horizontal'); } },
      // Theme commands
      ...themes.map(theme => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.name}`,
        description: getCurrentThemeId() === theme.id ? '● Active' : undefined,
        action: () => { applyTheme(theme.id); onClose(); },
      })),
    ],
    [send, dispatch, onClose, onLayoutChange, zoomedPaneId, onZoomPane],
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
