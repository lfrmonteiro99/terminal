import { useState } from 'react';
import { useAppState } from '../context/AppContext.tsx';

interface PostRunSummaryProps {
  runId: string;
  onGetDiff: (runId: string) => void;
  onMerge: (runId: string) => void;
  onRevert: (runId: string) => void;
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return '--';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return '--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function getExitCode(state: { type: string; exit_code?: number }): number | null {
  if (state.type === 'Completed' && typeof state.exit_code === 'number') {
    return state.exit_code;
  }
  return null;
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '16px 20px',
  fontFamily: 'monospace',
  fontSize: 13,
  backgroundColor: '#1a1a2e',
  color: '#e0e0e0',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 11,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  marginBottom: 4,
};

const buttonBase: React.CSSProperties = {
  padding: '6px 14px',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 'bold',
  fontFamily: 'monospace',
  fontSize: 12,
};

const accentButton: React.CSSProperties = {
  ...buttonBase,
  backgroundColor: '#4ecdc4',
  color: '#1a1a2e',
};

const dangerButton: React.CSSProperties = {
  ...buttonBase,
  backgroundColor: '#ff6b6b',
  color: '#fff',
};

const mutedButton: React.CSSProperties = {
  ...buttonBase,
  backgroundColor: '#444',
  color: '#e0e0e0',
};

export function PostRunSummary({ runId, onGetDiff, onMerge, onRevert }: PostRunSummaryProps) {
  const state = useAppState();
  const [showDiff, setShowDiff] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const run = state.runs.get(runId);
  if (!run) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#888' }}>Run not found: {runId}</div>
      </div>
    );
  }

  const cached = state.diffCache.get(runId);
  const exitCode = getExitCode(run.state);
  const hasDiffStat = run.diff_stat !== null;
  const conflict = state.mergeConflict?.runId === runId ? state.mergeConflict : null;

  const handleShowDiff = () => {
    if (!cached) {
      onGetDiff(runId);
    }
    setShowDiff(true);
  };

  const handleMergeConfirm = () => {
    onMerge(runId);
    setConfirmMerge(false);
  };

  const handleRevertConfirm = () => {
    onRevert(runId);
    setConfirmRevert(false);
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 4 }}>
          Run Summary
        </div>
        <div style={{ color: '#888', fontSize: 11 }}>
          {run.id.slice(0, 12)}...
        </div>
      </div>

      {/* Prompt */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Prompt</div>
        <div
          style={{
            padding: 10,
            backgroundColor: '#16213e',
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.5,
          }}
        >
          {run.prompt_preview}
        </div>
      </div>

      {/* Duration and Exit Code */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <div>
          <div style={labelStyle}>Duration</div>
          <div>{formatDuration(run.started_at, run.ended_at)}</div>
        </div>
        {exitCode !== null && (
          <div>
            <div style={labelStyle}>Exit Code</div>
            <div style={{ color: exitCode === 0 ? '#4ecdc4' : '#ff6b6b', fontWeight: 'bold' }}>
              {exitCode}
            </div>
          </div>
        )}
        <div>
          <div style={labelStyle}>Status</div>
          <div
            style={{
              color:
                run.state.type === 'Completed'
                  ? '#4ecdc4'
                  : run.state.type === 'Failed'
                    ? '#ff6b6b'
                    : '#888',
            }}
          >
            {run.state.type}
          </div>
        </div>
      </div>

      {/* DiffStat */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Changes</div>
        {hasDiffStat && run.diff_stat ? (
          <>
            <div style={{ marginBottom: 6 }}>
              {run.diff_stat.files_changed} files changed,{' '}
              <span style={{ color: '#4ecdc4' }}>+{run.diff_stat.insertions}</span>,{' '}
              <span style={{ color: '#ff6b6b' }}>-{run.diff_stat.deletions}</span>
            </div>
            <DiffStatBar
              insertions={run.diff_stat.insertions}
              deletions={run.diff_stat.deletions}
            />
          </>
        ) : (
          <div style={{ color: '#888' }}>
            {run.state.type === 'Completed' ? 'No git changes' : 'Not a git run'}
          </div>
        )}
      </div>

      {/* Merge Conflict Warning */}
      {conflict && (
        <div
          style={{
            padding: 12,
            backgroundColor: 'rgba(240, 165, 0, 0.15)',
            border: '1px solid #f0a500',
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          <div style={{ color: '#f0a500', fontWeight: 'bold', marginBottom: 6 }}>
            Merge Conflicts Detected
          </div>
          <div style={{ fontSize: 12, color: '#e0e0e0' }}>
            {conflict.paths.map((p) => (
              <div key={p} style={{ paddingLeft: 8 }}>
                {p}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={handleShowDiff} style={accentButton}>
          Show diff
        </button>
        {hasDiffStat && !confirmMerge && !confirmRevert && (
          <>
            <button onClick={() => setConfirmMerge(true)} style={accentButton}>
              Merge
            </button>
            <button onClick={() => setConfirmRevert(true)} style={dangerButton}>
              Revert
            </button>
          </>
        )}
      </div>

      {/* Merge Confirmation */}
      {confirmMerge && (
        <div
          style={{
            padding: 12,
            backgroundColor: '#2d2d44',
            borderRadius: 4,
            marginBottom: 16,
            border: '1px solid #4ecdc4',
          }}
        >
          <div style={{ marginBottom: 8 }}>Merge changes into your current branch?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleMergeConfirm} style={accentButton}>
              Yes
            </button>
            <button onClick={() => setConfirmMerge(false)} style={mutedButton}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Revert Confirmation */}
      {confirmRevert && (
        <div
          style={{
            padding: 12,
            backgroundColor: '#2d2d44',
            borderRadius: 4,
            marginBottom: 16,
            border: '1px solid #ff6b6b',
          }}
        >
          <div style={{ marginBottom: 8 }}>Discard all changes from this run?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleRevertConfirm} style={dangerButton}>
              Yes
            </button>
            <button onClick={() => setConfirmRevert(false)} style={mutedButton}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Diff Display */}
      {showDiff && (
        <div style={sectionStyle}>
          <div style={labelStyle}>Diff</div>
          {cached ? (
            <pre
              style={{
                padding: 12,
                backgroundColor: '#0d1117',
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: 400,
                fontSize: 12,
                lineHeight: 1.4,
                color: '#e0e0e0',
                margin: 0,
                whiteSpace: 'pre',
                border: '1px solid #333',
              }}
            >
              {cached.diff}
            </pre>
          ) : (
            <div style={{ color: '#888', padding: 8 }}>Loading diff...</div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffStatBar({ insertions, deletions }: { insertions: number; deletions: number }) {
  const total = insertions + deletions;
  if (total === 0) return null;

  const insPercent = (insertions / total) * 100;
  const delPercent = (deletions / total) * 100;

  return (
    <div
      style={{
        display: 'flex',
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#333',
        width: '100%',
        maxWidth: 300,
      }}
    >
      {insertions > 0 && (
        <div
          style={{
            width: `${insPercent}%`,
            backgroundColor: '#4ecdc4',
            transition: 'width 0.3s ease',
          }}
        />
      )}
      {deletions > 0 && (
        <div
          style={{
            width: `${delPercent}%`,
            backgroundColor: '#ff6b6b',
            transition: 'width 0.3s ease',
          }}
        />
      )}
    </div>
  );
}
