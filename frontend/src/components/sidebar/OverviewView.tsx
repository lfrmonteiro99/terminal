// OverviewView — the workspace dashboard.
//
// The entry point of the app: instead of dropping the operator into an empty
// terminal, it answers "where am I, what changed, what ran, who works here" on
// one screen, each card linking into the deeper view that owns the data.

import { useEffect } from 'react';
import {
  GitBranch, FolderTree, FileDiff, Users, ArrowRight, Plus, Bot,
} from 'lucide-react';
import { useAppState, useAppDispatch } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import type { FileStatus, RunState } from '../../types/protocol';

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function runDotColor(state: RunState): string {
  if (state.type === 'Running' || state.type === 'Preparing') return 'var(--accent-primary)';
  if (state.type === 'Completed') return state.exit_code === 0 ? 'var(--accent-primary)' : 'var(--accent-warn)';
  if (state.type === 'Failed') return 'var(--accent-error)';
  return 'var(--text-muted)';
}

function runLabel(state: RunState): string {
  if (state.type === 'Running' || state.type === 'Preparing') return 'running';
  if (state.type === 'Completed') return state.exit_code === 0 ? 'completed' : `exit ${state.exit_code}`;
  if (state.type === 'Failed') return 'failed';
  if (state.type === 'Cancelled') return 'cancelled';
  return state.type.toLowerCase();
}

function statusChar(status: FileStatus): string {
  if (status === 'Added') return 'A';
  if (status === 'Modified') return 'M';
  if (status === 'Deleted') return 'D';
  if (typeof status === 'object' && 'Renamed' in status) return 'R';
  return '?';
}

function statusColor(status: FileStatus): string {
  if (status === 'Added') return 'var(--accent-primary)';
  if (status === 'Modified') return 'var(--accent-warn)';
  if (status === 'Deleted') return 'var(--accent-error)';
  return 'var(--text-secondary)';
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function OverviewView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  // Pull the slices this dashboard reads. Each card's owner view re-fetches on
  // its own mount, so this is only about having data when Overview is first shown.
  useEffect(() => {
    const sessionId = state.activeSession;
    send({ type: 'GetRepoStatus' });
    send({ type: 'GetChangedFiles', mode: 'working' });
    send({ type: 'GetCommitHistory', limit: 20 });
    send({ type: 'ListAgents' });
    if (state.agents.size === 0) send({ type: 'ListCatalog' });
    if (sessionId) send({ type: 'ListRuns', session_id: sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = state.activeSession ? state.sessions.get(state.activeSession) : null;
  const repo = state.repoStatus;
  const changed = state.changedFiles?.files ?? [];
  const runs = Array.from(state.runs.values())
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  const agents = Array.from(state.agents.values()).sort((a, b) => a.name.localeCompare(b.name));
  const lastCommit = state.commitHistory[0];
  const dirtyTotal = (repo?.staged_count ?? 0) + (repo?.unstaged_count ?? 0);

  const openView = (view: 'explorer' | 'changes' | 'git' | 'agents') =>
    dispatch({ type: 'SET_SIDEBAR_VIEW', view });

  return (
    <div style={styles.page} data-view="overview">
      {/* Intro */}
      <div style={styles.intro}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.introTitle}>{session ? session.project_root.split(/[/\\]/).pop() ?? 'workspace' : 'No workspace'}</div>
          <div style={styles.introPath}>{session?.project_root ?? '—'}</div>
        </div>
      </div>

      <div style={styles.grid}>
        {/* Workspace status */}
        <Card
          title="Workspace"
          icon={<GitBranch size={13} strokeWidth={2} />}
          action={{ label: 'Git view', onClick: () => openView('git') }}
        >
          {repo ? (
            <>
              <Row label="Branch">
                <span style={styles.mono}>{repo.branch}</span>
                {repo.head && <span style={styles.sha}>{repo.head.slice(0, 7)}</span>}
              </Row>
              <Row label="Working tree">
                {dirtyTotal === 0 ? (
                  <span style={{ color: 'var(--accent-primary)' }}>clean</span>
                ) : (
                  <>
                    <span style={{ color: 'var(--accent-warn)' }}>{dirtyTotal} changed</span>
                    <span style={styles.muted}>
                      {repo.staged_count} staged · {repo.unstaged_count} unstaged
                    </span>
                  </>
                )}
              </Row>
              {lastCommit && (
                <Row label="Last commit">
                  <span style={{ color: 'var(--text-primary)' }}>{truncate(lastCommit.message, 46)}</span>
                  <span style={styles.muted}>{lastCommit.author} · {relativeTime(lastCommit.date)}</span>
                </Row>
              )}
            </>
          ) : (
            <Empty>No repository status yet — is this a git worktree?</Empty>
          )}
        </Card>

        {/* Activity */}
        <Card
          title="Activity"
          icon={<Bot size={13} strokeWidth={2} />}
          action={{ label: 'New AI run', onClick: () => window.dispatchEvent(new CustomEvent('focus-pane-kind', { detail: 'AiRun' })) }}
        >
          {runs.length === 0 ? (
            <Empty>No runs yet. Open the AI Run pane to start one (⌘K → New AI session).</Empty>
          ) : (
            runs.slice(0, 6).map(run => (
              <button
                key={run.id}
                onClick={() => dispatch({ type: 'SELECT_RUN', runId: run.id })}
                style={{
                  ...styles.listRow,
                  background: state.selectedRun === run.id ? 'rgba(var(--accent-primary-rgb), 0.10)' : 'transparent',
                }}
                onMouseEnter={e => { if (state.selectedRun !== run.id) e.currentTarget.style.background = 'var(--tint-hover)'; }}
                onMouseLeave={e => { if (state.selectedRun !== run.id) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ ...styles.stateDot, backgroundColor: runDotColor(run.state) }} />
                <span style={styles.rowMain}>
                  <span style={styles.rowTitle}>{truncate(run.prompt_preview || '(no prompt)', 54)}</span>
                  <span style={styles.rowMeta}>
                    {runLabel(run.state)}
                    {run.modified_file_count > 0 ? ` · ${run.modified_file_count} files` : ''}
                    {run.started_at ? ` · ${relativeTime(run.started_at)}` : ''}
                  </span>
                </span>
              </button>
            ))
          )}
        </Card>

        {/* Agents */}
        <Card
          title="Agents"
          icon={<Users size={13} strokeWidth={2} />}
          action={{ label: 'Manage', onClick: () => openView('agents') }}
        >
          {agents.length === 0 ? (
            <Empty>
              No agents yet — create one so runs inherit a stable mission.
              <button onClick={() => openView('agents')} style={styles.inlineLink}>
                <Plus size={12} strokeWidth={2.4} /> New agent
              </button>
            </Empty>
          ) : (
            agents.slice(0, 6).map(agent => (
              <div key={agent.id} style={styles.listRowStatic}>
                <span style={styles.avatar}>{agent.name.slice(0, 1).toUpperCase()}</span>
                <span style={styles.rowMain}>
                  <span style={styles.rowTitle}>{agent.name}</span>
                  <span style={styles.rowMeta}>
                    {agent.role_id ? state.roles.get(agent.role_id)?.name ?? agent.role_id : 'no role'}
                    {agent.personality_id ? ` · ${state.personalities.get(agent.personality_id)?.name ?? agent.personality_id}` : ''}
                  </span>
                </span>
                <span style={styles.pill}>{agent.runner}</span>
              </div>
            ))
          )}
        </Card>

        {/* Changed files */}
        <Card
          title="Working tree"
          icon={<FileDiff size={13} strokeWidth={2} />}
          action={{ label: 'All changes', onClick: () => openView('changes') }}
        >
          {changed.length === 0 ? (
            <Empty>Nothing uncommitted. <button onClick={() => openView('explorer')} style={styles.inlineLink}><FolderTree size={12} strokeWidth={2.4} /> Browse files</button></Empty>
          ) : (
            changed.slice(0, 7).map(file => (
              <button
                key={file.path}
                onClick={() => {
                  dispatch({ type: 'OPEN_DIFF', file: file.path });
                  // The panel only renders once the diff arrives — request it here too.
                  send({ type: 'GetFileDiff', file_path: file.path, mode: 'working' });
                }}
                title={`Open diff · ${file.path}`}
                style={styles.listRow}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--tint-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ ...styles.statusChip, color: statusColor(file.status) }}>{statusChar(file.status)}</span>
                <span style={{ ...styles.rowTitle, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-small)' }}>
                  {truncate(file.path, 42)}
                </span>
              </button>
            ))
          )}
          {changed.length > 7 && (
            <div style={styles.moreLabel}>+{changed.length - 7} more</div>
          )}
        </Card>
      </div>
    </div>
  );
}

// --- Local primitives ---

function Card({
  title, icon, action, children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section style={styles.card}>
      <header style={styles.cardHead}>
        <span style={styles.cardTitle}>
          <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{icon}</span>
          {title}
        </span>
        {action && (
          <button onClick={action.onClick} style={styles.cardAction}>
            {action.label}
            <ArrowRight size={12} strokeWidth={2.2} />
          </button>
        )}
      </header>
      <div style={styles.cardBody}>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.statRow}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{children}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={styles.empty}>{children}</div>;
}

const styles = {
  page: {
    padding: '16px 16px 24px',
    fontFamily: 'var(--font-display)',
    color: 'var(--text-primary)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  } as React.CSSProperties,
  intro: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  } as React.CSSProperties,
  introTitle: {
    fontSize: 'var(--font-size-title)',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)',
  } as React.CSSProperties,
  introPath: {
    marginTop: 2,
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  } as React.CSSProperties,
  card: {
    background: 'var(--tint-card)',
    border: '1px solid var(--tint-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '12px 12px 10px',
    minWidth: 0,
  } as React.CSSProperties,
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  } as React.CSSProperties,
  cardTitle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
  } as React.CSSProperties,
  cardAction: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--accent-primary)',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    opacity: 0.9,
  } as React.CSSProperties,
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  } as React.CSSProperties,
  statRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    padding: '5px 0',
    borderTop: '1px solid var(--tint-border)',
  } as React.CSSProperties,
  statLabel: {
    width: 84,
    flexShrink: 0,
    fontSize: 'var(--font-size-small)',
    color: 'var(--text-muted)',
  } as React.CSSProperties,
  statValue: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 'var(--font-size-small)',
    minWidth: 0,
    flexWrap: 'wrap',
  } as React.CSSProperties,
  mono: { fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' } as React.CSSProperties,
  sha: { fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: 'var(--font-size-micro)' } as React.CSSProperties,
  muted: { color: 'var(--text-muted)', fontSize: 'var(--font-size-micro)' } as React.CSSProperties,
  listRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    padding: '7px 6px',
    border: 'none',
    borderRadius: 'var(--radius-xs)',
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'var(--font-display)',
  } as React.CSSProperties,
  listRowStatic: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '7px 6px',
  } as React.CSSProperties,
  rowMain: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 } as React.CSSProperties,
  rowTitle: {
    fontSize: 'var(--font-size-small)',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  rowMeta: {
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
    marginTop: 1,
  } as React.CSSProperties,
  stateDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 } as React.CSSProperties,
  statusChip: {
    width: 16,
    height: 16,
    borderRadius: 'var(--radius-xs)',
    border: '1px solid currentColor',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    opacity: 0.9,
  } as React.CSSProperties,
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--accent-primary-15)',
    color: 'var(--accent-primary)',
    fontSize: 'var(--font-size-small)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  } as React.CSSProperties,
  pill: {
    flexShrink: 0,
    padding: '2px 7px',
    borderRadius: 'var(--radius-pill)',
    background: 'var(--tint-active)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
  } as React.CSSProperties,
  empty: {
    padding: '8px 4px',
    fontSize: 'var(--font-size-small)',
    color: 'var(--text-muted)',
    lineHeight: 1.6,
  } as React.CSSProperties,
  inlineLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    marginLeft: 6,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--accent-primary)',
    fontSize: 'var(--font-size-small)',
    fontWeight: 600,
  } as React.CSSProperties,
  moreLabel: {
    padding: '6px 6px 0',
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
  } as React.CSSProperties,
};
