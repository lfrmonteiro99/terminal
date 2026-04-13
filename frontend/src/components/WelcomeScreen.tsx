import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
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

/** Small animated terminal glyph used as the Welcome logo. */
function TerminalGlyph({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 0 10px rgba(var(--accent-primary-rgb), 0.35))' }}
    >
      <rect
        x="3.5"
        y="7.5"
        width="41"
        height="33"
        rx="7"
        stroke="var(--accent-primary)"
        strokeWidth="1.8"
        fill="var(--bg-raised)"
      />
      <circle cx="10" cy="13.5" r="1.3" fill="var(--accent-error)" opacity="0.75" />
      <circle cx="14.5" cy="13.5" r="1.3" fill="var(--accent-warn)" opacity="0.75" />
      <circle cx="19" cy="13.5" r="1.3" fill="var(--accent-primary)" opacity="0.75" />
      {/* Prompt caret */}
      <path
        d="M11 27 L15 30 L11 33"
        stroke="var(--accent-primary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Blinking cursor line */}
      <rect
        x="18.5"
        y="29"
        width="16"
        height="2"
        rx="1"
        fill="var(--accent-primary)"
        style={{ animation: 'caret-blink 1.4s steps(2) infinite' }}
      />
    </svg>
  );
}

export function WelcomeScreen({ onOpenSession, onNewSession, tauriMode, onBrowse }: WelcomeScreenProps) {
  const [sessions, setSessions] = useState<SavedSession[]>(() => getSavedSessions());
  const [newPath, setNewPath] = useState('');
  const [hoveredRoot, setHoveredRoot] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

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
      {/* Subtle teal spotlight behind the card */}
      <div style={styles.spotlight} aria-hidden="true" />
      <div style={styles.card} className="anim-scale-in">
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>
            <TerminalGlyph size={48} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={styles.logoTitle}>Terminal Engine</span>
              <span style={styles.subtitle}>your workspace, your way</span>
            </div>
          </div>
        </div>

        {/* Recent sessions */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Recent</div>
          {sessions.length === 0 ? (
            <div style={styles.emptyState}>
              <span>no recent sessions — start your first below</span>
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                style={{
                  color: 'var(--accent-primary)',
                  opacity: 0.7,
                  animation: 'chevron-nudge 1.6s ease-in-out infinite',
                }}
              />
            </div>
          ) : (
            <div style={styles.sessionList}>
              {sessions.map((session, idx) => {
                const paneCount = collectPanes(session.layout).length;
                const isHovered = hoveredRoot === session.projectRoot;
                return (
                  <div
                    key={session.projectRoot}
                    className="stagger-in"
                    style={{
                      ...styles.sessionRow,
                      ...(isHovered ? styles.sessionRowHover : {}),
                      ['--i' as string]: idx,
                    } as React.CSSProperties}
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
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="/path/to/project"
              style={{
                ...styles.pathInput,
                ...(inputFocused ? styles.pathInputFocused : {}),
              }}
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
          <div style={styles.hint}>
            <span style={styles.kbd}>⌘K</span>
            <span>for commands</span>
            <span style={styles.dot}>·</span>
            <span style={styles.kbd}>⌘/</span>
            <span>for shortcuts</span>
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
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    width: '100%',
    background: 'var(--bg-base)',
    overflow: 'hidden',
  },
  spotlight: {
    position: 'absolute',
    inset: 0,
    background:
      'radial-gradient(ellipse 900px 500px at 50% 32%, rgba(var(--accent-primary-rgb), 0.07) 0%, transparent 65%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 12,
    padding: '36px 40px',
    width: '100%',
    maxWidth: 580,
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
    boxShadow: 'var(--shadow-overlay), var(--glow-accent)',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  logoTitle: {
    fontSize: 26,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    letterSpacing: '-0.02em',
    lineHeight: 1,
    background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent-primary) 110%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  },
  subtitle: {
    margin: 0,
    fontSize: 13,
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-display)',
    fontWeight: 400,
    letterSpacing: '0.01em',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    fontFamily: 'var(--font-display)',
  },
  emptyState: {
    padding: '20px 16px',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontFamily: 'var(--font-display)',
    background: 'transparent',
    borderRadius: 8,
    border: '1.5px dashed var(--border-default)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
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
    transition: 'background 140ms var(--ease-out-expo), border-color 140ms, box-shadow 160ms',
  },
  sessionRowHover: {
    background: 'var(--bg-raised)',
    border: '1px solid var(--border-default)',
    boxShadow: '0 0 0 1px var(--accent-primary-08)',
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
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sessionPath: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
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
    fontFamily: 'var(--font-mono)',
  },
  sessionTime: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  sessionActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  openBtn: {
    padding: '6px 14px',
    background: 'var(--accent-primary)',
    color: 'var(--bg-base)',
    border: 'none',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    letterSpacing: '0.01em',
    boxShadow: 'var(--glow-accent)',
    transition: 'box-shadow 160ms, transform 160ms var(--ease-out-expo)',
  },
  deleteBtn: {
    padding: '4px 7px',
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border-default)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    transition: 'opacity 0.15s',
  },
  newSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingTop: 12,
    borderTop: '1px solid var(--border-default)',
  },
  newRow: {
    display: 'flex',
    gap: 8,
  },
  pathInput: {
    flex: 1,
    padding: '9px 12px',
    background: 'var(--bg-raised)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 160ms, box-shadow 200ms var(--ease-out-expo)',
  },
  pathInputFocused: {
    borderColor: 'var(--accent-primary)',
    boxShadow: 'var(--glow-accent)',
  },
  browseBtn: {
    padding: '8px 14px',
    background: 'transparent',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    letterSpacing: '0.01em',
    flexShrink: 0,
    transition: 'border-color 160ms, background 160ms',
  },
  startBtn: {
    padding: '8px 20px',
    background: 'var(--accent-primary)',
    color: 'var(--bg-base)',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 700,
    fontFamily: 'var(--font-display)',
    fontSize: 13,
    letterSpacing: '0.01em',
    flexShrink: 0,
    boxShadow: 'var(--glow-accent)',
    transition: 'box-shadow 160ms, transform 120ms var(--ease-out-back)',
  },
  startBtnDisabled: {
    opacity: 'var(--disabled-opacity)' as unknown as number,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-display)',
    paddingTop: 2,
  },
  kbd: {
    padding: '1px 6px',
    border: '1px solid var(--border-default)',
    borderRadius: 4,
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-secondary)',
    letterSpacing: '0.04em',
  },
  dot: {
    opacity: 0.5,
  },
};
