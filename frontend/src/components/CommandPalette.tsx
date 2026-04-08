// Command palette — fast actions across all modes (M7-02)

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSend } from '../context/SendContext';
import { useAppDispatch } from '../context/AppContext';
import type { PaneLayout } from '../domain/pane/types';
import type { BranchInfo } from '../types/protocol';
import { themes, applyTheme, getCurrentThemeId } from '../styles/themes';
import { getShortcut, resetShortcuts } from '../core/shortcutMap';
import { LAYOUT_PRESETS } from '../core/layoutPresets';
import {
  getQuickCommands,
  saveQuickCommand,
  deleteQuickCommand,
  type QuickCommand,
} from '../state/quickCommands';

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
  onShowShortcuts?: () => void;
}

// Use shared presets — map to PaneLayout for backward compat
const PRESETS: Record<string, PaneLayout> = Object.fromEntries(
  Object.entries(LAYOUT_PRESETS).map(([k, v]) => [k, v.layout])
);

type PaletteMode = 'commands' | 'quick-commands' | 'save-name' | 'save-cmd' | 'branches' | 'new-branch';

export function CommandPalette({ open, onClose, onLayoutChange, onSplitH, onSplitV, onAddPane, zoomedPaneId, onZoomPane, onShowShortcuts }: CommandPaletteProps) {
  const send = useSend();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PaletteMode>('commands');
  const [saveName, setSaveName] = useState('');
  const [quickCmds, setQuickCmds] = useState<QuickCommand[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reload snippets whenever we enter quick-commands mode
  useEffect(() => {
    if (mode === 'quick-commands') {
      setQuickCmds(getQuickCommands());
    }
  }, [mode]);

  const allCommands: Command[] = useMemo(
    () => [
      // Quick command entries
      {
        id: 'quick:manage',
        label: 'Quick Commands',
        description: 'View and run saved commands',
        action: () => { setMode('quick-commands'); setQuery(''); setSelectedIndex(0); },
      },
      {
        id: 'quick:save',
        label: 'Save Quick Command',
        description: 'Save a command snippet for later use',
        action: () => { setMode('save-name'); setQuery(''); setSelectedIndex(0); },
      },
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
      // Git branch
      {
        id: 'git:switch-branch',
        label: 'Switch Branch',
        description: 'Browse and checkout a local branch',
        shortcut: getShortcut('git:switch-branch'),
        action: () => { setMode('branches'); setQuery(''); setSelectedIndex(0); },
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
      // Help
      {
        id: 'help:shortcuts',
        label: 'Show Keyboard Shortcuts',
        description: 'Open the keyboard shortcut cheatsheet',
        shortcut: 'Ctrl+/',
        action: () => { onShowShortcuts?.(); onClose(); },
      },
      // Keybinding management
      {
        id: 'keybindings:reset',
        label: 'Reset All Keybindings',
        description: 'Restore default keyboard shortcuts',
        action: () => { resetShortcuts(); onClose(); },
      },
      // Add pane commands
      { id: 'add:search', label: 'Add Pane: Search', description: 'Add a search pane to grep across project files', action: () => { onAddPane?.('Search', 'Horizontal'); } },
      { id: 'add:fileviewer', label: 'Add Pane: File Viewer', description: 'Add a file viewer pane', action: () => { onAddPane?.('FileViewer', 'Horizontal'); } },
      { id: 'add:terminal', label: 'Add Pane: Terminal', description: 'Add a terminal pane to the right', action: () => { onAddPane?.('Terminal', 'Horizontal'); } },
      { id: 'add:terminal:down', label: 'Add Pane: Terminal (below)', description: 'Add a terminal pane below', action: () => { onAddPane?.('Terminal', 'Vertical'); } },
      { id: 'add:ai', label: 'Add Pane: AI Run', description: 'Add an AI prompt pane', action: () => { onAddPane?.('AiRun', 'Horizontal'); } },
      { id: 'add:browser', label: 'Add Pane: Browser', description: 'Add a browser pane', action: () => { onAddPane?.('Browser', 'Horizontal'); } },
      { id: 'add:gitstatus', label: 'Add Pane: Git Status', description: 'Add a git status pane', action: () => { onAddPane?.('GitStatus', 'Horizontal'); } },
      { id: 'add:githistory', label: 'Add Pane: Git History', description: 'Add a git history pane', action: () => { onAddPane?.('GitHistory', 'Horizontal'); } },
      { id: 'add:empty', label: 'Add Pane: Empty', description: 'Add an empty pane and choose type', action: () => { onAddPane?.('Empty', 'Horizontal'); } },
      // Notifications
      {
        id: 'notifications:toggle',
        label: 'Toggle Terminal Notifications',
        description: localStorage.getItem('terminal:notifications') === 'false' ? 'Currently: OFF' : 'Currently: ON',
        action: () => {
          const current = localStorage.getItem('terminal:notifications');
          localStorage.setItem('terminal:notifications', current === 'false' ? 'true' : 'false');
          onClose();
        },
      },
      // Theme commands
      ...themes.map(theme => ({
        id: `theme:${theme.id}`,
        label: `Theme: ${theme.name}`,
        description: getCurrentThemeId() === theme.id ? '● Active' : undefined,
        action: () => { applyTheme(theme.id); onClose(); },
      })),
    ],
    [send, dispatch, onClose, onLayoutChange, zoomedPaneId, onZoomPane, onShowShortcuts],
  );

  // Determine effective mode: if query starts with '!' override to quick-commands,
  // if query starts with '>' override to branches (or back if backspaced past '>')
  const effectiveMode: PaletteMode = useMemo(() => {
    if (mode === 'save-name' || mode === 'save-cmd') return mode;
    if (mode === 'new-branch') return mode;
    if (query.startsWith('!')) return 'quick-commands';
    if (query.startsWith('>')) return 'branches';
    if (mode === 'branches') return 'branches';
    return mode;
  }, [query, mode]);

  const filteredCommands = useMemo(() => {
    if (effectiveMode !== 'commands') return [];
    if (!query.trim()) return allCommands;
    const q = query.toLowerCase();
    return allCommands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
    );
  }, [allCommands, query, effectiveMode]);

  const filteredQuickCmds = useMemo(() => {
    if (effectiveMode !== 'quick-commands') return [];
    // Strip leading '!' for filter
    const q = query.startsWith('!') ? query.slice(1).toLowerCase() : query.toLowerCase();
    if (!q) return quickCmds;
    return quickCmds.filter(
      (c) => c.name.toLowerCase().includes(q) || c.command.toLowerCase().includes(q),
    );
  }, [quickCmds, query, effectiveMode]);

  const filteredBranches = useMemo(() => {
    if (effectiveMode !== 'branches') return [];
    const q = query.startsWith('>') ? query.slice(1).trim().toLowerCase() : query.toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, query, effectiveMode]);

  const listLength =
    effectiveMode === 'quick-commands' ? filteredQuickCmds.length :
    effectiveMode === 'branches' ? filteredBranches.length + 1 : // +1 for "Create New Branch..."
    filteredCommands.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, effectiveMode]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setMode('commands');
      setSaveName('');
      setBranches([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep quickCmds fresh when mode flips to quick-commands via '!' prefix
  useEffect(() => {
    if (effectiveMode === 'quick-commands') {
      setQuickCmds(getQuickCommands());
    }
  }, [effectiveMode]);

  // Request branch list when entering branches mode
  useEffect(() => {
    if (effectiveMode === 'branches') {
      send({ type: 'ListBranches' });
    }
  }, [effectiveMode, send]);

  // Listen for BranchList events routed from App.tsx
  useEffect(() => {
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail;
      setBranches(event.branches ?? []);
    };
    window.addEventListener('branch-list', handler);
    return () => window.removeEventListener('branch-list', handler);
  }, []);

  const handleDeleteQuickCmd = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteQuickCommand(id);
    setQuickCmds(getQuickCommands());
  };

  const handleRunQuickCmd = (cmd: QuickCommand) => {
    window.dispatchEvent(new CustomEvent('write-to-terminal', { detail: { data: cmd.command + '\n' } }));
    onClose();
  };

  const handleSelectBranch = (branch: BranchInfo) => {
    send({ type: 'CheckoutBranch', name: branch.name });
    onClose();
  };

  const handleCreateNewBranch = () => {
    setMode('new-branch');
    setQuery('');
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (mode === 'branches' && !query.startsWith('>')) {
        setMode('commands');
        setQuery('');
        return;
      }
      if (mode !== 'commands') {
        setMode('commands');
        setQuery('');
        setSaveName('');
        return;
      }
      onClose();
      return;
    }

    if (effectiveMode === 'save-name') {
      if (e.key === 'Enter') {
        const trimmed = query.trim();
        if (trimmed) {
          setSaveName(trimmed);
          setMode('save-cmd');
          setQuery('');
        }
        e.preventDefault();
      }
      return;
    }

    if (effectiveMode === 'save-cmd') {
      if (e.key === 'Enter') {
        const trimmed = query.trim();
        if (trimmed && saveName) {
          saveQuickCommand(saveName, trimmed);
        }
        setMode('commands');
        setQuery('');
        setSaveName('');
        onClose();
        e.preventDefault();
      }
      return;
    }

    if (effectiveMode === 'new-branch') {
      if (e.key === 'Enter') {
        const trimmed = query.trim();
        if (trimmed) {
          send({ type: 'CreateBranch', name: trimmed });
          onClose();
        }
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') { setSelectedIndex((i) => Math.min(i + 1, listLength - 1)); e.preventDefault(); return; }
    if (e.key === 'ArrowUp') { setSelectedIndex((i) => Math.max(i - 1, 0)); e.preventDefault(); return; }
    if (e.key === 'Enter') {
      if (effectiveMode === 'quick-commands') {
        const cmd = filteredQuickCmds[selectedIndex];
        if (cmd) handleRunQuickCmd(cmd);
      } else if (effectiveMode === 'branches') {
        if (selectedIndex === filteredBranches.length) {
          handleCreateNewBranch();
        } else {
          const branch = filteredBranches[selectedIndex];
          if (branch) handleSelectBranch(branch);
        }
      } else {
        filteredCommands[selectedIndex]?.action();
      }
      return;
    }
  };

  if (!open) return null;

  // Placeholder and header text per mode
  const placeholderText =
    effectiveMode === 'save-name' ? 'Snippet name (e.g. Run tests)...' :
    effectiveMode === 'save-cmd' ? `Command for "${saveName}"...` :
    effectiveMode === 'quick-commands' ? 'Filter snippets...' :
    effectiveMode === 'branches' ? 'Switch Branch: filter branches...' :
    effectiveMode === 'new-branch' ? 'New branch name...' :
    'Type a command or ! for quick commands or > for branches...';

  const headerLabel =
    effectiveMode === 'save-name' ? 'Save Quick Command — Step 1: enter a name' :
    effectiveMode === 'save-cmd' ? `Save Quick Command — Step 2: enter the command` :
    effectiveMode === 'quick-commands' ? 'Quick Commands' :
    effectiveMode === 'branches' ? 'Switch Branch' :
    effectiveMode === 'new-branch' ? 'Create New Branch' :
    null;

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
          width: 560,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {headerLabel && (
          <div style={{
            padding: '8px 16px',
            backgroundColor: 'var(--bg-overlay)',
            borderBottom: '1px solid var(--border-default)',
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
          }}>
            {headerLabel}
          </div>
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
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
          {/* Quick-commands list */}
          {effectiveMode === 'quick-commands' && filteredQuickCmds.map((cmd, idx) => (
            <div
              key={cmd.id}
              onClick={() => handleRunQuickCmd(cmd)}
              onMouseEnter={() => { setSelectedIndex(idx); setHoveredId(cmd.id); }}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                backgroundColor: idx === selectedIndex ? 'var(--bg-overlay)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {cmd.name}
                </span>
                <span style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {cmd.command.length > 60 ? cmd.command.slice(0, 60) + '…' : cmd.command}
                </span>
              </div>
              {hoveredId === cmd.id && (
                <button
                  onClick={(e) => handleDeleteQuickCmd(cmd.id, e)}
                  title="Delete snippet"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--accent-error, #f87171)',
                    fontSize: 14,
                    padding: '2px 4px',
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {effectiveMode === 'quick-commands' && filteredQuickCmds.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
              {quickCmds.length === 0
                ? 'No saved commands. Use "Save Quick Command" to add one.'
                : 'No matching snippets'}
            </div>
          )}

          {/* Branch picker list */}
          {effectiveMode === 'branches' && filteredBranches.map((branch, idx) => (
            <div
              key={branch.name}
              onClick={() => handleSelectBranch(branch)}
              onMouseEnter={() => setSelectedIndex(idx)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                backgroundColor: idx === selectedIndex ? 'var(--bg-overlay)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 13, color: branch.is_head ? 'var(--accent-success, #4ade80)' : 'var(--text-primary)', fontFamily: 'monospace', flex: 1 }}>
                {branch.is_head ? '● ' : '  '}{branch.name}
              </span>
              {branch.last_commit_summary && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 220,
                }}>
                  {branch.last_commit_summary}
                </span>
              )}
            </div>
          ))}
          {effectiveMode === 'branches' && (
            <div
              onClick={handleCreateNewBranch}
              onMouseEnter={() => setSelectedIndex(filteredBranches.length)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                backgroundColor: selectedIndex === filteredBranches.length ? 'var(--bg-overlay)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderTop: filteredBranches.length > 0 ? '1px solid var(--border-default)' : undefined,
              }}
            >
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                + Create New Branch...
              </span>
            </div>
          )}
          {effectiveMode === 'branches' && branches.length === 0 && (
            <div style={{ padding: '8px 16px', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'monospace' }}>
              Loading branches...
            </div>
          )}

          {/* new-branch input guidance */}
          {effectiveMode === 'new-branch' && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
              Press Enter to create branch, Escape to cancel
            </div>
          )}

          {/* Normal commands list */}
          {effectiveMode === 'commands' && filteredCommands.map((cmd, idx) => (
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
          {effectiveMode === 'commands' && filteredCommands.length === 0 && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
              No commands found
            </div>
          )}

          {/* Save modes — no list, just input guidance already shown via header */}
          {(effectiveMode === 'save-name' || effectiveMode === 'save-cmd') && (
            <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
              Press Enter to confirm, Escape to cancel
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
