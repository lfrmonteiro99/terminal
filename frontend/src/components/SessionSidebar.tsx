import { useAppState, useAppDispatch } from '../context/AppContext.tsx';
import type { RunSummary, RunState } from '../types/protocol.ts';

function getStatusColor(state: RunState): string {
  switch (state.type) {
    case 'Running':
    case 'Preparing':
      return '#4ecdc4';
    case 'Completed':
      return '#4ecdc4';
    case 'Failed':
      return '#ff6b6b';
    case 'Cancelled':
      return '#888';
    default:
      return '#f0a500';
  }
}

function isRunning(state: RunState): boolean {
  return state.type === 'Running' || state.type === 'Preparing';
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

const sidebarStyle: React.CSSProperties = {
  width: 250,
  flexShrink: 0,
  backgroundColor: '#1a1a2e',
  borderRight: '1px solid #333',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: 'monospace',
  fontSize: 12,
};

const sidebarHeaderStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontWeight: 'bold',
  fontSize: 13,
  color: '#e0e0e0',
  borderBottom: '1px solid #333',
  flexShrink: 0,
};

const scrollContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
};

const sessionBlockStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #2a2a3e',
};

const pulseKeyframes = `
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`;

export function SessionSidebar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const sessions = Array.from(state.sessions.values());
  const runsMap = state.runs;

  return (
    <div style={sidebarStyle}>
      <style>{pulseKeyframes}</style>
      <div style={sidebarHeaderStyle}>Sessions</div>
      <div style={scrollContainerStyle}>
        {sessions.length === 0 && (
          <div style={{ padding: '16px 12px', color: '#888' }}>
            No sessions
          </div>
        )}
        {sessions.map((session) => {
          const isActive = session.id === state.activeSession;
          const sessionRuns: RunSummary[] = [];
          for (const run of runsMap.values()) {
            // Include runs that belong to this session by checking if the run
            // exists in the runs map. Since RunSummary does not carry session_id,
            // when a session is active all loaded runs belong to it.
            sessionRuns.push(run);
          }
          // Sort chronologically by started_at
          sessionRuns.sort(
            (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
          );

          return (
            <div key={session.id} style={sessionBlockStyle}>
              <div
                style={{
                  color: isActive ? '#4ecdc4' : '#e0e0e0',
                  fontWeight: isActive ? 'bold' : 'normal',
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {truncate(session.project_root.split('/').pop() ?? session.id.slice(0, 8), 28)}
              </div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>
                {session.id.slice(0, 8)}... | {session.run_count} runs
              </div>
              {sessionRuns.map((run) => {
                const isSelected = run.id === state.selectedRun;
                const running = isRunning(run.state);
                const dotColor = getStatusColor(run.state);

                return (
                  <div
                    key={run.id}
                    onClick={() => dispatch({ type: 'SELECT_RUN', runId: run.id })}
                    style={{
                      padding: '4px 8px',
                      marginBottom: 2,
                      borderRadius: 3,
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'rgba(78, 205, 196, 0.15)' : 'transparent',
                      borderLeft: isSelected ? '2px solid #4ecdc4' : '2px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          backgroundColor: dotColor,
                          flexShrink: 0,
                          animation: running ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
                        }}
                      />
                      <span
                        style={{
                          color: '#e0e0e0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {truncate(run.prompt_preview, 40)}
                      </span>
                    </div>
                    <div style={{ color: '#888', fontSize: 10, marginTop: 2, paddingLeft: 13 }}>
                      {formatRelativeTime(run.started_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Git section */}
      <div style={{ borderTop: '1px solid #333', padding: '12px 16px', flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Git
        </div>
        <div
          onClick={() => dispatch({ type: 'TOGGLE_STASH_DRAWER' })}
          style={{
            padding: '6px 8px',
            cursor: 'pointer',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            color: '#e0e0e0',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#16213e')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          {'\u25CB'} Stashes{state.stashes.length > 0 ? ` (${state.stashes.length})` : ''}
        </div>
      </div>
    </div>
  );
}
