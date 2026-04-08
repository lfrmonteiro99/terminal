import { useAppState, useAppDispatch } from '../../context/AppContext';
import type { RunState } from '../../types/protocol';

function getStatusColor(state: RunState): string {
  switch (state.type) {
    case 'Running':
    case 'Preparing':
      return 'var(--accent-primary)';
    case 'Completed':
      return 'var(--accent-primary)';
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
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

  // Get runs for this session, sorted chronologically
  const sessionRuns = Array.from(state.runs.values())
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  const folderName = session.project_root.split(/[/\\]/).pop() ?? session.id.slice(0, 8);

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: '1px solid var(--border-default)',
      fontFamily: 'monospace',
      fontSize: 12,
    }}>
      <style>{pulseKeyframes}</style>
      <div style={{
        padding: '8px 12px 4px',
        color: 'var(--accent-primary)',
        fontWeight: 'bold',
        fontSize: 13,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {truncate(folderName, 28)}
      </div>
      <div style={{
        padding: '0 12px 4px',
        color: 'var(--text-muted)',
        fontSize: 11,
      }}>
        {session.id.slice(0, 8)}... | {session.run_count} runs
      </div>
      <div style={{
        maxHeight: 120,
        overflowY: 'auto',
        padding: '0 8px 8px',
      }}>
        {sessionRuns.map((run) => {
          const isSelected = run.id === state.selectedRun;
          const running = isRunning(run.state);
          const dotColor = getStatusColor(run.state);

          return (
            <div
              key={run.id}
              onClick={() => dispatch({ type: 'SELECT_RUN', runId: run.id })}
              style={{
                padding: '3px 6px',
                marginBottom: 1,
                borderRadius: 3,
                cursor: 'pointer',
                backgroundColor: isSelected ? 'rgba(78, 205, 196, 0.15)' : 'transparent',
                borderLeft: isSelected ? '2px solid var(--accent-primary)' : '2px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: dotColor,
                flexShrink: 0,
                animation: running ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
              }} />
              <span style={{
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                fontSize: 11,
              }}>
                {truncate(run.prompt_preview, 30)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
