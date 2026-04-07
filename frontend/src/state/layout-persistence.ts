// Workspace layout and pane state persistence (M2-05)
// Uses localStorage with atomic-style writes (write then set).

import type { PaneLayout } from '../domain/pane/types';
import type { WorkspaceMode } from '../domain/workspace/types';

interface PersistedWorkspace {
  id: string;
  name: string;
  rootPath: string;
  mode: WorkspaceMode;
  layout: PaneLayout;
  focusedPaneId: string | null;
  savedAt: string;
}

const STORAGE_KEY = 'terminal:workspaces';

export function saveWorkspaceLayout(ws: PersistedWorkspace): void {
  try {
    const existing = loadAllWorkspaceLayouts();
    existing.set(ws.id, ws);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(existing.values())));
  } catch {
    // localStorage may be full — silently ignore
  }
}

export function loadWorkspaceLayout(workspaceId: string): PersistedWorkspace | null {
  const all = loadAllWorkspaceLayouts();
  return all.get(workspaceId) ?? null;
}

export function loadAllWorkspaceLayouts(): Map<string, PersistedWorkspace> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr: PersistedWorkspace[] = JSON.parse(raw);
    return new Map(arr.map((w) => [w.id, w]));
  } catch {
    return new Map();
  }
}

export function deleteWorkspaceLayout(workspaceId: string): void {
  const all = loadAllWorkspaceLayouts();
  all.delete(workspaceId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(all.values())));
}

export function persistDiffMode(mode: 'split' | 'overlay' | 'inline'): void {
  localStorage.setItem('diff-mode', mode);
}

export function loadDiffMode(): 'split' | 'overlay' | 'inline' {
  return (localStorage.getItem('diff-mode') as 'split' | 'overlay' | 'inline') || 'split';
}
