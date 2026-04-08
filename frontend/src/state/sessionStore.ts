// Persistent session store — saved sessions keyed by projectRoot in localStorage

import type { PaneLayout } from '../domain/pane/types';

export interface SavedSession {
  projectRoot: string;
  name: string;          // last segment of path
  lastUsed: string;      // ISO date
  layout: PaneLayout;
  theme: string;
  sidebarView: 'explorer' | 'changes' | 'git';
  sidebarCollapsed: boolean;
}

const STORAGE_KEY = 'terminal:saved-sessions';
const MAX_SESSIONS = 10;

function readAll(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedSession[];
  } catch {
    return [];
  }
}

function writeAll(sessions: SavedSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage quota — silently ignore
  }
}

/** Returns sessions sorted by lastUsed descending (newest first), capped at MAX_SESSIONS. */
export function getSavedSessions(): SavedSession[] {
  return readAll()
    .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, MAX_SESSIONS);
}

/** Upsert a session by projectRoot. If it exists, update it; otherwise prepend. */
export function saveSession(session: SavedSession): void {
  const all = readAll();
  const idx = all.findIndex(s => s.projectRoot === session.projectRoot);
  if (idx >= 0) {
    all[idx] = session;
  } else {
    all.unshift(session);
  }
  // Trim to MAX_SESSIONS (sort first so we drop the oldest)
  const trimmed = all
    .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, MAX_SESSIONS);
  writeAll(trimmed);
}

/** Remove a session by projectRoot. */
export function deleteSession(projectRoot: string): void {
  const all = readAll().filter(s => s.projectRoot !== projectRoot);
  writeAll(all);
}

/** Retrieve a single session by projectRoot, or null if not found. */
export function getSession(projectRoot: string): SavedSession | null {
  return readAll().find(s => s.projectRoot === projectRoot) ?? null;
}
