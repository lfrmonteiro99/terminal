import { useState, useEffect } from 'react';
import { getSavedSessions, deleteSession } from '../state/sessionStore';
import type { SavedSession } from '../state/sessionStore';
import { collectPanes } from '../domain/pane/types';

interface WelcomeScreenProps {
  onOpenSession: (projectRoot: string) => void;
  onNewSession: (projectRoot: string) => void;
  tauriMode?: boolean;
  onBrowse?: () => Promise<string | null>;
}

function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function WelcomeScreen({ onOpenSession, onNewSession, tauriMode, onBrowse }: WelcomeScreenProps) {
  const [sessions, setSessions] = useState<SavedSession[]>(() => getSavedSessions());
  const [newPath, setNewPath] = useState('');
  const [hoveredRoot, setHoveredRoot] = useState<string | null>(null);

  // Refresh list whenever localStorage changes (e.g. other tab)
  useEffect(() => {
    const handler = () => setSessions(getSavedSessions());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleDelete = (projectRoot: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession(projectRoot);
    setSessions(getSavedSessions());
  };

  const handleStart = () => {
    const trimmed = newPath.trim();
    if (trimmed) onNewSession(trimmed);
  };

  const handleBrowseClick = async () => {
    if (!onBrowse) return;
    const path = await onBrowse();
    if (path) setNewPath(path);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>⌨</span>
            <span style={styles.logoTitle}>Terminal Engine</span>
          </div>
          <p style={styles.subtitle}>Start a session</p>
        </div>

        {/* Recent sessions */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Recent</div>
          {sessions.length === 0 ? (
            <div style={styles.emptyState}>
              No recent sessions. Enter a project path below to start.
            </div>
          ) : (
            <div style={styles.sessionList}>
              {sessions.map(session => {
                const paneCount = collectPanes(session.layout).length;
                const isHovered = hoveredRoot === session.projectRoot;
                return (
                  <div
                    key={session.projectRoot}
                    style={{ ...styles.sessionRow, ...(isHovered ? styles.sessionRowHover : {}) }}
                    onMouseEnter={() => setHoveredRoot(session.projectRoot)}
                    onMouseLeave={() => setHoveredRoot(null)}
                  >
                    <div style={styles.sessionInfo}>
                      <span style={styles.sessionName}>{session.name}</span>
                      <span style={styles.sessionPath}>{session.projectRoot}</span>
                    </div>
                    <div style={styles.sessionMeta}>
                      <span style={styles.sessionPanes}>{paneCount} {paneCount === 1 ? 'pane' : 'panes'}</span>
                      <span style={styles.sessionTime}>{relativeTime(session.lastUsed)}</span>
                    </div>
                    <div style={styles.sessionActions}>
                      <button
                        style={styles.openBtn}
                        onClick={() => onOpenSession(session.projectRoot)}
                        title="Open session"
                      >
                        Open
                      </button>
                      <button
                        style={{
                          ...styles.deleteBtn,
                          opacity: isHovered ? 1 : 0,
                        }}
                        onClick={(e) => handleDelete(session.projectRoot, e)}
                        title="Remove from list"
                        tabIndex={isHovered ? 0 : -1}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* New session */}
        <div style={styles.newSection}>
          <div style={styles.sectionLabel}>New Session</div>
          <div style={styles.newRow}>
            <input
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStart()}
              placeholder="/path/to/project"
              style={styles.pathInput}
              autoFocus
            />
            {tauriMode && onBrowse && (
              <button onClick={handleBrowseClick} style={styles.browseBtn}>
                Browse
              </button>
            )}
            <button
              onClick={handleStart}
              style={{ ...styles.startBtn, ...(newPath.trim() ? {} : styles.startBtnDisabled) }}
              disabled={!newPath.trim()}
            >
              Start
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    width: '100%',
    background: 'var(--bg-base)',
  },
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 10,
    padding: '32px 36px',
    width: '100%',
    maxWidth: 580,
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
    boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    fontSize: 22,
    lineHeight: 1,
    color: 'var(--accent-primary)',
  },
  logoTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
    letterSpacing: '-0.3px',
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: 'var(--text-secondary)',
    fontFamily: 'monospace',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    fontFamily: 'monospace',
  },
  emptyState: {
    padding: '14px 12px',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontFamily: 'monospace',
    background: 'var(--bg-raised)',
    borderRadius: 6,
    border: '1px solid var(--border-default)',
  },
  sessionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sessionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid transparent',
    cursor: 'default',
    transition: 'background 0.1s, border-color 0.1s',
  },
  sessionRowHover: {
    background: 'var(--bg-raised)',
    border: '1px solid var(--border-default)',
  },
  sessionInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  sessionName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sessionPath: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sessionMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  sessionPanes: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    fontFamily: 'monospace',
  },
  sessionTime: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
  },
  sessionActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  openBtn: {
    padding: '5px 12px',
    background: 'var(--accent-primary)',
    color: 'var(--bg-base)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  deleteBtn: {
    padding: '4px 7px',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-default)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'monospace',
    transition: 'opacity 0.15s',
  },
  newSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingTop: 4,
    borderTop: '1px solid var(--border-default)',
  },
  newRow: {
    display: 'flex',
    gap: 8,
  },
  pathInput: {
    flex: 1,
    padding: '8px 10px',
    background: 'var(--bg-raised)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 5,
    fontFamily: 'monospace',
    fontSize: 13,
    outline: 'none',
  },
  browseBtn: {
    padding: '8px 14px',
    background: 'var(--bg-overlay)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  startBtn: {
    padding: '8px 18px',
    background: 'var(--accent-primary)',
    color: 'var(--bg-base)',
    border: 'none',
    borderRadius: 5,
    cursor: 'pointer',
    fontWeight: 700,
    fontFamily: 'monospace',
    fontSize: 13,
    flexShrink: 0,
  },
  startBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
};
