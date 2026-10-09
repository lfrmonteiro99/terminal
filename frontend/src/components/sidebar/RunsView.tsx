// RunsView — the run menu: every run this workspace has produced, with the
// actions that are actually possible on each one.
//
// Two things shape it.
//
// 1. Runs are spread across sessions. The daemon opens a session per
//    `StartSession`, so a session-scoped list would show almost none of a
//    project's history; the list is requested with `all_sessions`.
// 2. Rows are grouped by *what still needs a decision*, not by date. A run list
//    that can only say "finished" is useless: merge and revert delete the
//    worktree but leave the run's own state alone, so `Completed` covers both
//    "your work is merged" and "your work is still sitting there". The daemon
//    sends `worktree_present` for exactly this, and it is the only honest
//    signal available. Merged and reverted are therefore one group, and it is
//    labelled as such rather than guessed at.

import { useEffect, useMemo, useState } from 'react';
import {
  Eye, GitMerge, Undo2, Square, RotateCcw, Copy, ChevronDown,
  ChevronRight, AlertTriangle, History,
} from 'lucide-react';
import { useAppState, useAppDispatch } from '../../context/AppContext';
import { useSend } from '../../context/SendContext';
import { ConfirmModal } from '../ConfirmModal';
import { parseDiffLines } from '../../core/diff/parse';
import { copyText } from '../../core/clipboard';
import type { RunSummary } from '../../types/protocol';

type Group = 'active' | 'review' | 'resolved';

function isRunning(run: RunSummary): boolean {
  return run.state.type === 'Running' || run.state.type === 'Preparing';
}

function isTerminal(run: RunSummary): boolean {
  return (
    run.state.type === 'Completed' ||
    run.state.type === 'Failed' ||
    run.state.type === 'Cancelled'
  );
}

function groupOf(run: RunSummary): Group {
  if (isRunning(run)) return 'active';
  // Terminal and the worktree is still on disk: the work is waiting on a
  // merge or a revert.
  if (run.worktree_present) return 'review';
  return 'resolved';
}

const GROUP_LABEL: Record<Group, string> = {
  active: 'Running now',
  review: 'Needs a decision',
  resolved: 'Resolved (merged or reverted)',
};

const GROUP_HINT: Record<Group, string> = {
  active: 'Still executing',
  review: 'The worktree is still on disk — merge it or throw it away',
  resolved: 'The worktree is gone. The daemon does not record which of the two happened',
};

function stateLabel(run: RunSummary): string {
  const s = run.state;
  if (s.type === 'Running' || s.type === 'Preparing') return 'running';
  if (s.type === 'Completed') return s.exit_code === 0 ? 'completed' : `exit ${s.exit_code}`;
  if (s.type === 'Failed') return 'failed';
  if (s.type === 'Cancelled') return 'cancelled';
  return s.type.toLowerCase();
}

function stateColor(run: RunSummary): string {
  const s = run.state;
  if (s.type === 'Running' || s.type === 'Preparing') return 'var(--accent-primary)';
  if (s.type === 'Completed') return s.exit_code === 0 ? 'var(--accent-primary)' : 'var(--accent-warn)';
  if (s.type === 'Failed') return 'var(--accent-error)';
  return 'var(--text-muted)';
}

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

function duration(run: RunSummary): string {
  if (!run.ended_at) return '—';
  const ms = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function RunsView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const send = useSend();

  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'merge' | 'revert'; run: RunSummary } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (state.activeSession) {
      send({ type: 'ListRuns', session_id: state.activeSession, all_sessions: true });
    }
    if (state.agents.size === 0) send({ type: 'ListAgents' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeSession]);

  const runs = useMemo(
    () =>
      Array.from(state.runs.values()).sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      ),
    [state.runs],
  );

  const grouped = useMemo(() => {
    const out: Record<Group, RunSummary[]> = { active: [], review: [], resolved: [] };
    for (const run of runs) out[groupOf(run)].push(run);
    return out;
  }, [runs]);

  const agentName = (id: string | null): string => {
    if (!id) return 'Claude (default)';
    return state.agents.get(id)?.name ?? 'agent deleted';
  };

  const flash = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied(prev => (prev === key ? null : prev)), 1600);
  };

  const doCopy = async (key: string, text: string) => {
    const ok = await copyText(text);
    flash(ok ? key : `${key}:fail`);
  };

  const rerun = (run: RunSummary) => {
    if (!state.activeSession || !run.prompt) return;
    dispatch({ type: 'MARK_RUN_PENDING', prompt: run.prompt });
    send({
      type: 'StartRun',
      session_id: state.activeSession,
      prompt: run.prompt,
      mode: run.mode,
      autonomy: run.autonomy,
      agent_id: run.agent_id ?? undefined,
    });
  };

  const cancel = (run: RunSummary) =>
    send({ type: 'CancelRun', run_id: run.id, reason: 'Cancelled from the run list' });

  const viewDiff = (run: RunSummary) => {
    const opening = openRunId !== run.id;
    setOpenRunId(opening ? run.id : null);
    // Only ask for the diff when there is a worktree to diff against. Without
    // this guard, opening a resolved run fired GetDiff, the daemon answered
    // NOT_FOUND and the app painted a red error banner for a run that simply
    // had nothing left to diff.
    if (opening && run.worktree_present && !state.diffCache.get(run.id)) {
      send({ type: 'GetDiff', run_id: run.id });
    }
  };

  if (!state.activeSession) {
    return (
      <div style={styles.empty}>
        <History size={18} strokeWidth={1.6} />
        <div style={{ marginTop: 8 }}>Open a workspace to see its runs.</div>
      </div>
    );
  }

  return (
    <div style={styles.page} data-view="runs">
      <style>{pulseKeyframes}</style>
      <div style={styles.head}>
        <span>Runs</span>
        <span style={styles.countPill}>{runs.length}</span>
      </div>

      {runs.length === 0 ? (
        <div style={styles.empty}>
          <div>No runs in this workspace yet.</div>
          <div style={{ marginTop: 6, fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>
            Start one from the AI Run pane.
          </div>
        </div>
      ) : (
        (['active', 'review', 'resolved'] as Group[]).map(group => {
          const items = grouped[group];
          if (items.length === 0) return null;
          return (
            <div key={group} style={{ marginBottom: 6 }}>
              <div style={styles.groupHead} title={GROUP_HINT[group]}>
                <span>{GROUP_LABEL[group]}</span>
                <span style={styles.groupCount}>{items.length}</span>
              </div>
              {items.map(run => (
                <RunRow
                  key={run.id}
                  run={run}
                  open={openRunId === run.id}
                  selected={state.selectedRun === run.id}
                  agentLabel={agentName(run.agent_id)}
                  diff={state.diffCache.get(run.id)?.diff}
                  hasDiff={state.diffCache.has(run.id)}
                  copied={copied}
                  onToggle={() => {
                    dispatch({ type: 'SELECT_RUN', runId: run.id });
                    viewDiff(run);
                  }}
                  onCopy={doCopy}
                  onRerun={() => rerun(run)}
                  onCancel={() => cancel(run)}
                  onMerge={() => setConfirm({ kind: 'merge', run })}
                  onRevert={() => setConfirm({ kind: 'revert', run })}
                />
              ))}
            </div>
          );
        })
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'merge' ? 'Merge this run into the branch?' : 'Revert this run?'}
          body={
            <>
              {confirm.kind === 'merge' ? (
                <>
                  The worktree is committed as it stands, then merged. The branch and
                  the worktree are deleted afterwards.
                </>
              ) : (
                <>
                  The worktree is removed and the branch is <strong>force-deleted</strong>.
                  Commits on it that were never merged are destroyed.
                </>
              )}
              <div style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-micro)', color: 'var(--text-muted)' }}>
                {truncate(confirm.run.prompt_preview || '(no prompt)', 90)}
              </div>
            </>
          }
          confirmLabel={confirm.kind === 'merge' ? 'Merge' : 'Revert'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { kind, run } = confirm;
            if (kind === 'merge') send({ type: 'MergeRun', run_id: run.id });
            else send({ type: 'RevertRun', run_id: run.id });
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

// --- Row ---

function RunRow({
  run,
  open,
  selected,
  agentLabel,
  diff,
  hasDiff,
  copied,
  onToggle,
  onCopy,
  onRerun,
  onCancel,
  onMerge,
  onRevert,
}: {
  run: RunSummary;
  open: boolean;
  selected: boolean;
  agentLabel: string;
  diff: string | undefined;
  hasDiff: boolean;
  copied: string | null;
  onToggle: () => void;
  onCopy: (key: string, text: string) => void;
  onRerun: () => void;
  onCancel: () => void;
  onMerge: () => void;
  onRevert: () => void;
}) {
  const running = isRunning(run);
  const terminal = isTerminal(run);
  const canDecide = run.worktree_present && terminal;

  return (
    <div style={{
      ...styles.row,
      borderColor: open ? 'var(--accent-primary)' : 'var(--tint-border)',
      background: selected ? 'rgba(var(--accent-primary-rgb), 0.06)' : 'var(--bg-surface)',
    }} data-run-id={run.id}>
      <button onClick={onToggle} className="touch-row" style={styles.rowHead}>
        <span style={{ flexShrink: 0, color: 'var(--text-muted)', display: 'inline-flex' }}>
          {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronRight size={13} strokeWidth={2} />}
        </span>
        <span style={{
          ...styles.dot,
          backgroundColor: stateColor(run),
          animation: running ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
        }} />
        <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
          <span style={styles.rowTitle}>{truncate(run.prompt_preview || '(no prompt)', 64)}</span>
          <span style={styles.rowMeta}>
            <span style={{ color: stateColor(run) }}>{stateLabel(run)}</span>
            {' · '}{agentLabel}
            {run.modified_file_count > 0 ? ` · ${run.modified_file_count} files` : ''}
            {' · '}{relativeTime(run.started_at)}
          </span>
        </span>
        {canDecide && (
          <span style={styles.reviewChip} title="Worktree still on disk">
            <AlertTriangle size={10} strokeWidth={2.4} /> review
          </span>
        )}
      </button>

      {open && (
        <div style={styles.detail}>
          <div style={styles.metaGrid}>
            <Meta label="Duration" value={duration(run)} />
            <Meta label="Mode" value={run.mode} />
            <Meta label="Autonomy" value={run.autonomy === 'ReviewPlan' ? 'Plan first' : 'Autonomous'} />
            <Meta label="Branch" value={run.branch || '—'} mono />
            <Meta label="Files" value={String(run.modified_file_count)} />
            <Meta label="Run id" value={run.id.slice(0, 12)} mono />
          </div>

          {run.prompt && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.label}>Prompt</div>
              <div style={styles.promptBox}>{run.prompt}</div>
            </div>
          )}

          {run.state.type === 'Failed' && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.label}>Why it failed</div>
              <div style={{ ...styles.promptBox, color: 'var(--accent-error)' }}>
                {run.state.error}
                {run.state.phase ? ` (phase: ${run.state.phase})` : ''}
              </div>
            </div>
          )}

          {hasDiff && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.label}>Diff</div>
              {diff ? <DiffPreview diff={diff} /> : (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
                  No changes in this run.
                </div>
              )}
            </div>
          )}

          {!run.worktree_present && terminal && (
            <div style={styles.note}>
              The worktree is gone, so this run can no longer be merged, reverted or
              diffed — only re-run.
            </div>
          )}

          <div style={styles.actions}>
            {running ? (
              <Action Icon={Square} label="Stop" onClick={onCancel} tone="danger" />
            ) : (
              <Action Icon={RotateCcw} label="Re-run" onClick={onRerun} tone="primary" />
            )}
            <Action
              Icon={Eye}
              label={hasDiff ? 'Refresh diff' : 'Diff'}
              onClick={onToggle}
              disabled={!run.worktree_present}
              title={run.worktree_present ? 'Load the run diff' : 'The worktree is gone'}
            />
            <Action
              Icon={GitMerge}
              label="Merge"
              onClick={onMerge}
              disabled={!canDecide}
              title={canDecide ? 'Commit and merge this run' : 'Only a finished run with a worktree can be merged'}
            />
            <Action
              Icon={Undo2}
              label="Revert"
              onClick={onRevert}
              tone="danger"
              disabled={!canDecide}
              title={canDecide ? 'Discard the worktree and its branch' : 'Nothing left to revert'}
            />
            <Action
              Icon={Copy}
              label={copied === `${run.id}:prompt` ? 'Copied' : 'Copy prompt'}
              onClick={() => onCopy(`${run.id}:prompt`, run.prompt)}
              disabled={!run.prompt}
            />
            <Action
              Icon={Copy}
              label={copied === `${run.id}:id` ? 'Copied' : 'Copy id'}
              onClick={() => onCopy(`${run.id}:id`, run.id)}
            />
          </div>

          {copied === `${run.id}:prompt:fail` || copied === `${run.id}:id:fail` ? (
            <div style={{ ...styles.note, color: 'var(--accent-error)' }}>
              Copy failed — this browser blocked clipboard access.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={styles.label}>{label}</div>
      <div style={{
        fontSize: 'var(--font-size-small)',
        color: 'var(--text-primary)',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-display)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}

function Action({
  Icon,
  label,
  onClick,
  tone = 'plain',
  disabled,
  title,
}: {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  tone?: 'plain' | 'primary' | 'danger';
  disabled?: boolean;
  title?: string;
}) {
  const color =
    tone === 'primary' ? 'var(--accent-primary)'
      : tone === 'danger' ? 'var(--accent-error)'
        : 'var(--text-secondary)';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 26,
        padding: '0 9px',
        borderRadius: 'var(--radius-sm)',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: disabled ? 'var(--tint-border)' : 'var(--border-default)',
        background: 'transparent',
        color: disabled ? 'var(--text-muted)' : color,
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--font-size-micro)',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={12} strokeWidth={2} />
      {label}
    </button>
  );
}

function DiffPreview({ diff }: { diff: string }) {
  const lines = useMemo(() => parseDiffLines(diff), [diff]);
  return (
    <pre style={styles.diff} data-run-diff>
      {lines.map((line, i) => {
        const bg =
          line.type === 'added' ? 'var(--diff-added-bg)'
            : line.type === 'removed' ? 'var(--diff-removed-bg)'
              : 'transparent';
        const fg =
          line.type === 'added' ? 'var(--diff-added-fg)'
            : line.type === 'removed' ? 'var(--diff-removed-fg)'
              : line.type === 'hunk' ? 'var(--accent-info)'
                : line.type === 'meta' ? 'var(--text-muted)'
                  : 'var(--text-secondary)';
        return (
          <div key={i} style={{ background: bg, color: fg }}>
            {line.text}
          </div>
        );
      })}
    </pre>
  );
}

// --- styles ---

const pulseKeyframes = `
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '10px 10px 18px',
    fontFamily: 'var(--font-display)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '2px 4px 8px',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    letterSpacing: '0.09em',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
  },
  countPill: {
    minWidth: 18,
    height: 16,
    padding: '0 6px',
    borderRadius: 'var(--radius-pill)',
    background: 'var(--tint-active)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 4px 4px',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  groupCount: {
    color: 'var(--text-muted)',
    fontWeight: 500,
  },
  row: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 'var(--radius-md)',
    marginBottom: 4,
    overflow: 'hidden',
  },
  rowHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 7,
    width: '100%',
    padding: '8px 9px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
  },
  dot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    marginTop: 5,
    borderRadius: '50%',
    flexShrink: 0,
  },
  rowTitle: {
    display: 'block',
    fontSize: 'var(--font-size-small)',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowMeta: {
    display: 'block',
    marginTop: 2,
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
  },
  reviewChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    flexShrink: 0,
    marginTop: 2,
    padding: '1px 6px',
    borderRadius: 'var(--radius-pill)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--accent-warn)',
    color: 'var(--accent-warn)',
    fontSize: 'var(--font-size-micro)',
    fontWeight: 600,
  },
  detail: {
    padding: '0 10px 10px 28px',
    borderTop: '1px solid var(--tint-border)',
    marginTop: 2,
    paddingTop: 10,
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
    gap: '8px 10px',
  },
  label: {
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 3,
  },
  promptBox: {
    padding: 8,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-base)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--tint-border)',
    fontSize: 'var(--font-size-small)',
    lineHeight: 1.5,
    color: 'var(--text-secondary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: 180,
    overflowY: 'auto',
  },
  note: {
    marginTop: 10,
    fontSize: 'var(--font-size-micro)',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  diff: {
    margin: 0,
    padding: 8,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-base)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--tint-border)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--font-size-micro)',
    lineHeight: 1.5,
    maxHeight: 260,
    overflow: 'auto',
    whiteSpace: 'pre',
  },
  empty: {
    padding: '20px 8px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 'var(--font-size-small)',
  },
};
