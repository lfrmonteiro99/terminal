import { useState } from 'react';
import { Eye, Zap } from 'lucide-react';
import { useAppState } from '../context/AppContext.tsx';

interface PostRunSummaryProps {
  runId: string;
  onGetDiff: (runId: string) => void;
  onMerge: (runId: string) => void;
  onRevert: (runId: string) => void;
  /** Fired when the user approves a plan-mode run and wants to execute it. */
  onApprovePlan?: (originalPrompt: string) => void;
}

function formatCost(usd: number): string {
  if (usd === 0) return 'free';
  if (usd < 0.01) return `<$0.01`;
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
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
  backgroundColor: 'var(--bg-surface)',
  color: 'var(--text-primary)',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
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
  backgroundColor: 'var(--accent-primary)',
  color: 'var(--bg-surface)',
};

const dangerButton: React.CSSProperties = {
  ...buttonBase,
  backgroundColor: 'var(--accent-error)',
  color: 'var(--text-primary)',
};

const mutedButton: React.CSSProperties = {
  ...buttonBase,
  backgroundColor: 'var(--border-default)',
  color: 'var(--text-primary)',
};

export function PostRunSummary({ runId, onGetDiff, onMerge, onRevert, onApprovePlan }: PostRunSummaryProps) {
  const state = useAppState();
  const [showDiff, setShowDiff] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const run = state.runs.get(runId);
  if (!run) {
    return (
      <div style={containerStyle}>
        <div style={{ color: 'var(--text-muted)' }}>Run not found: {runId}</div>
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
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {run.id.slice(0, 12)}...
        </div>
      </div>

      {/* Prompt */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Prompt</div>
        <div
          style={{
            padding: 10,
            backgroundColor: 'var(--bg-surface)',
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
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={labelStyle}>Duration</div>
          <div>{formatDuration(run.started_at, run.ended_at)}</div>
        </div>
        {exitCode !== null && (
          <div>
            <div style={labelStyle}>Exit Code</div>
            <ExitCodeBadge code={exitCode} />
          </div>
        )}
        <div>
          <div style={labelStyle}>Status</div>
          <div
            style={{
              color:
                run.state.type === 'Completed'
                  ? 'var(--accent-primary)'
                  : run.state.type === 'Failed'
                    ? 'var(--accent-error)'
                    : 'var(--text-muted)',
            }}
          >
            {run.state.type}
          </div>
        </div>
        {run.autonomy && (
          <div>
            <div style={labelStyle}>Mode</div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                color: run.autonomy === 'ReviewPlan' ? 'var(--accent-info)' : 'var(--accent-primary)',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {run.autonomy === 'ReviewPlan' ? <Eye size={12} strokeWidth={2} /> : <Zap size={12} strokeWidth={2} />}
              {run.autonomy === 'ReviewPlan' ? 'Plan' : 'Autonomous'}
            </div>
          </div>
        )}
        {state.runMetrics && (
          <>
            <div>
              <div style={labelStyle}>Turns</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{state.runMetrics.num_turns}</div>
            </div>
            <div>
              <div style={labelStyle}>Cost</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-warn)' }}>
                {formatCost(state.runMetrics.cost_usd)}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Tokens</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>in </span>
                {formatTokens(state.runMetrics.input_tokens)}
                <span style={{ color: 'var(--text-muted)' }}> · </span>
                <span style={{ color: 'var(--text-secondary)' }}>out </span>
                {formatTokens(state.runMetrics.output_tokens)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Approve & execute (plan runs only, when completed successfully) */}
      {run.autonomy === 'ReviewPlan'
        && run.state.type === 'Completed'
        && exitCode === 0
        && onApprovePlan && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 8,
              border: '1px solid rgba(var(--accent-primary-rgb), 0.35)',
              background: 'var(--accent-primary-08)',
              boxShadow: 'var(--glow-accent)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Eye size={16} strokeWidth={2} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--text-primary)' }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Plan ready for review</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                no files were modified — approve to run the same prompt autonomously
              </div>
            </div>
            <button
              onClick={() => onApprovePlan(run.prompt_preview)}
              style={{
                padding: '8px 14px',
                background: 'var(--accent-primary)',
                color: 'var(--bg-base)',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: '0.02em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: 'var(--glow-accent-strong)',
              }}
            >
              <Zap size={13} strokeWidth={2} />
              Approve &amp; execute
            </button>
          </div>
        )}

      {/* Failure reason — shown prominently when the run failed mid-stream.
          AI-BUG-01 / issue #113. */}
      {run.state.type === 'Failed' && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 6,
            border: '1px solid var(--accent-error)',
            backgroundColor: 'rgba(var(--accent-error-rgb), 0.08)',
          }}
        >
          <div
            style={{
              color: 'var(--accent-error)',
              fontWeight: 'bold',
              marginBottom: 4,
              fontSize: 13,
            }}
          >
            Run failed ({run.state.phase})
          </div>
          <div
            style={{
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {run.state.error}
          </div>
        </div>
      )}

      {/* DiffStat */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Changes</div>
        {hasDiffStat && run.diff_stat ? (
          <>
            <div style={{ marginBottom: 6 }}>
              {run.diff_stat.files_changed} files changed,{' '}
              <span style={{ color: 'var(--accent-primary)' }}>+{run.diff_stat.insertions}</span>,{' '}
              <span style={{ color: 'var(--accent-error)' }}>-{run.diff_stat.deletions}</span>
            </div>
            <DiffStatBar
              insertions={run.diff_stat.insertions}
              deletions={run.diff_stat.deletions}
            />
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>
            {run.state.type === 'Completed'
              ? 'No git changes'
              : run.state.type === 'Failed'
                ? 'Run did not complete'
                : 'Not a git run'}
          </div>
        )}
      </div>

      {/* Merge Conflict Warning */}
      {conflict && (
        <div
          style={{
            padding: 12,
            backgroundColor: 'rgba(240, 165, 0, 0.15)',
            border: '1px solid var(--accent-warn)',
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          <div style={{ color: 'var(--accent-warn)', fontWeight: 'bold', marginBottom: 6 }}>
            Merge Conflicts Detected
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
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
            backgroundColor: 'var(--bg-raised)',
            borderRadius: 4,
            marginBottom: 16,
            border: '1px solid var(--accent-primary)',
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
            backgroundColor: 'var(--bg-raised)',
            borderRadius: 4,
            marginBottom: 16,
            border: '1px solid var(--accent-error)',
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
                backgroundColor: 'var(--bg-base)',
                borderRadius: 4,
                overflow: 'auto',
                maxHeight: 400,
                fontSize: 12,
                lineHeight: 1.4,
                color: 'var(--text-primary)',
                margin: 0,
                whiteSpace: 'pre',
                border: '1px solid var(--border-default)',
              }}
            >
              {cached.diff}
            </pre>
          ) : (
            <div style={{ color: 'var(--text-muted)', padding: 8 }}>Loading diff...</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Exit-code badge with a subtle sparkle burst on success. */
function ExitCodeBadge({ code }: { code: number }) {
  const success = code === 0;
  const color = success ? 'var(--accent-primary)' : 'var(--accent-error)';
  const glow = success ? 'var(--glow-accent)' : 'var(--glow-error)';
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 28,
          padding: '2px 10px',
          borderRadius: 10,
          border: `1px solid ${color}`,
          color,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: 12,
          boxShadow: glow,
          background: success ? 'var(--accent-primary-08)' : 'rgba(var(--accent-error-rgb), 0.08)',
        }}
      >
        {code}
      </span>
      {success && <Sparkles />}
    </div>
  );
}

/** 6 tiny dots bursting outward on mount. GPU-only. */
function Sparkles() {
  const dots = [
    { dx: '22px', dy: '-14px', color: 'var(--accent-primary)', size: 3, delay: 0 },
    { dx: '-18px', dy: '-18px', color: '#fff', size: 2, delay: 40 },
    { dx: '24px', dy: '10px', color: 'var(--accent-warn)', size: 3, delay: 80 },
    { dx: '-22px', dy: '8px', color: 'var(--accent-primary)', size: 2, delay: 60 },
    { dx: '4px', dy: '-22px', color: '#fff', size: 2, delay: 110 },
    { dx: '8px', dy: '20px', color: 'var(--accent-primary)', size: 2, delay: 140 },
  ];
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        display: 'block',
      }}
    >
      {dots.map((d, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: d.size,
            height: d.size,
            borderRadius: '50%',
            background: d.color,
            boxShadow: `0 0 6px ${d.color}`,
            opacity: 0,
            ['--dx' as string]: d.dx,
            ['--dy' as string]: d.dy,
            animation: `sparkle-burst 720ms var(--ease-out-expo) ${d.delay}ms forwards`,
          } as React.CSSProperties}
        />
      ))}
    </span>
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
        backgroundColor: 'var(--border-default)',
        width: '100%',
        maxWidth: 300,
      }}
    >
      {insertions > 0 && (
        <div
          style={{
            width: `${insPercent}%`,
            backgroundColor: 'var(--accent-primary)',
            boxShadow: 'inset 0 0 6px rgba(var(--accent-primary-rgb), 0.4)',
            transition: 'width 320ms var(--ease-out-expo)',
          }}
        />
      )}
      {deletions > 0 && (
        <div
          style={{
            width: `${delPercent}%`,
            backgroundColor: 'var(--accent-error)',
            boxShadow: 'inset 0 0 6px rgba(var(--accent-error-rgb), 0.4)',
            transition: 'width 320ms var(--ease-out-expo)',
          }}
        />
      )}
    </div>
  );
}
