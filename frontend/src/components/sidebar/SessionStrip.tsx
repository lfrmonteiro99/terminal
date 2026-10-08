// SessionStrip — the run list for the active workspace, at the top of the
// content panel. Rows are selectable: selecting a run drives RunPanel /
// PostRunSummary (diff, merge, revert) in the pane surface.

import { useAppState, useAppDispatch } from '../../context/AppContext';
import type { RunState } from '../../types/protocol';

function getStatusColor(state: RunState): string {
  switch (state.type) {
    case 'Running':
    case 'Preparing':
      return 'var(--accent-primary)';
    case 'Completed':
      return state.exit_code === 0 ? 'var(--accent-primary)' : 'var(--accent-warn)';
    case 'Failed':
      return 'var(--accent-error)';
    case 'Cancelled':
      return 'var(--text-muted)';
    default:
      return 'var(--accent-warn)';
  }
}

function isRunning(state: RunState): boolean {
  return state.type === 'Running' || state.type === 'Preparing';
}

function stateLabel(state: RunState): string {
  if (state.type === 'Running' || state.type === 'Preparing') return 'running';
  if (state.type === 'Completed') return state.exit_code === 0 ? 'done' : `exit ${state.exit_code}`;
  if (state.type === 'Failed') return 'failed';
  if (state.type === 'Cancelled') return 'cancelled';
  return state.type.toLowerCase();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const pulseKeyframes = `
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`;

export function SessionStrip() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const session = state.activeSession ? state.sessions.get(state.activeSession) : null;
  if (!session) return null;

  const sessionRuns = Array.from(state.runs.values())
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: '1px solid var(--tint-border)',
      fontFamily: 'var(--font-display)',
    }}>
      <style>{pulseKeyframes}</style>

      <div style={sectionHeadStyle}>
        <span>Runs</span>
        <span style={countPillStyle}>{sessionRuns.length}</span>
      </div>

      {sessionRuns.length === 0 ? (
        <div style={{ padding: '0 14px 10px', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          No runs in this workspace yet.
        </div>
      ) : (
        <div style={{ maxHeight: 168, overflowY: 'auto', padding: '0 8px 8px' }}>
          {sessionRuns.map((run) => {
            const isSelected = run.id === state.selectedRun;
            const running = isRunning(run.state);
            return (
              <button
                key={run.id}
                onClick={() => dispatch({ type: 'SELECT_RUN', runId: run.id })}
                title={run.prompt_preview}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  width: '100%',
                  padding: '6px 8px',
                  marginBottom: 1,
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: isSelected ? 'rgba(var(--accent-primary-rgb), 0.13)' : 'transparent',
                  color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                  fontFamily: 'var(--font-display)',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--tint-hover)'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  marginTop: 5,
                  borderRadius: '50%',
                  backgroundColor: getStatusColor(run.state),
                  flexShrink: 0,
                  animation: running ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
                }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{
                    display: 'block',
                    fontSize: 'var(--font-size-small)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {truncate(run.prompt_preview || '(no prompt)', 40)}
                  </span>
                  <span style={{
                    display: 'block',
                    marginTop: 1,
                    fontSize: 'var(--font-size-micro)',
                    color: 'var(--text-muted)',
                  }}>
                    {stateLabel(run.state)}
                    {run.modified_file_count > 0 ? ` · ${run.modified_file_count} files` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const sectionHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px 6px',
  fontSize: 'var(--font-size-micro)',
  fontWeight: 600,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
};

const countPillStyle: React.CSSProperties = {
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
};
