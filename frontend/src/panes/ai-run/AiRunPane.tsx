// AiRunPane — wraps the existing RunPanel as a pane (M2-04)

import { useMemo, useRef, useState } from 'react';
import { Bot, Eye, AlertTriangle, X } from 'lucide-react';
import { RunPanel } from '../../components/RunPanel';
import { PostRunSummary } from '../../components/PostRunSummary';
import { PromptComposer } from '../../components/PromptComposer';
import { useSend } from '../../context/SendContext';
import { useAppState, useAppDispatch } from '../../context/AppContext';
import { CommandBus } from '../../core/commands/commandBus';
import { RunService } from '../../core/services/runService';
import type { PaneProps } from '../registry';
import type { AutonomyLevel, RunMode, RunState } from '../../types/protocol';
import { registerPane } from '../registry';

const AUTONOMY_STORAGE_KEY = 'terminal:autonomy';

function loadAutonomy(): AutonomyLevel {
  const saved = localStorage.getItem(AUTONOMY_STORAGE_KEY);
  return saved === 'ReviewPlan' ? 'ReviewPlan' : 'Autonomous';
}

function isTerminalState(rs: RunState): boolean {
  return rs.type === 'Completed' || rs.type === 'Failed' || rs.type === 'Cancelled';
}

export function AiRunPane({ pane: _pane, workspaceId: _workspaceId }: PaneProps) {
  const send = useSend();
  const runService = useMemo(() => new RunService(new CommandBus(send)), [send]);
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [prompt, setPrompt] = useState('');
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(loadAutonomy);
  const isRunPending = state.pendingRunStartedAt !== null;
  // Remember the full prompt text for any active run so "Approve & execute"
  // can re-run a plan with the original text (RunSummary.prompt_preview is
  // truncated to 100 chars and unsafe to resubmit).
  const lastPromptRef = useRef<string>('');

  const updateAutonomy = (next: AutonomyLevel) => {
    setAutonomy(next);
    localStorage.setItem(AUTONOMY_STORAGE_KEY, next);
  };

  const startRun = (overridePrompt?: string, overrideAutonomy?: AutonomyLevel) => {
    const p = (overridePrompt ?? prompt).trim();
    if (!state.activeSession || !p) return;
    lastPromptRef.current = p;
    dispatch({ type: 'MARK_RUN_PENDING' });
    runService.startRun({
      sessionId: state.activeSession,
      prompt: p,
      mode: 'Free' as RunMode,
      autonomy: overrideAutonomy ?? autonomy,
    });
    if (!overridePrompt) setPrompt('');
  };


  const handleGetDiff = (runId: string) => runService.getDiff(runId);
  const handleRevert = (runId: string) => runService.revertRun(runId);
  const handleMerge = (runId: string) => runService.mergeRun(runId);

  const selectedRunObj = state.selectedRun ? state.runs.get(state.selectedRun) : undefined;
  const showPostRunSummary =
    !state.activeRun && selectedRunObj !== undefined && isTerminalState(selectedRunObj.state);

  // Re-run the completed plan prompt in autonomous mode. Prefer the full
  // prompt we stashed when kicking off the plan run; fall back to the
  // (possibly truncated) summary preview if we've lost it (e.g. on refresh).
  const handleApprovePlan = (promptPreviewFallback: string) => {
    const full = lastPromptRef.current || promptPreviewFallback;
    startRun(full, 'Autonomous');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {state.preflightError && (
        <PreflightBanner
          reason={state.preflightError.reason}
          suggestion={state.preflightError.suggestion}
          onDismiss={() => dispatch({ type: 'DISMISS_PREFLIGHT' })}
        />
      )}

      {state.activeRun ? (
        <RunPanel />
      ) : showPostRunSummary && state.selectedRun ? (
        <PostRunSummary
          runId={state.selectedRun}
          onGetDiff={handleGetDiff}
          onMerge={handleMerge}
          onRevert={handleRevert}
          onApprovePlan={handleApprovePlan}
        />
      ) : (
        <RunPanel />
      )}

      {state.activeSession && !state.activeRun && (
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'var(--bg-surface)',
          }}
        >
          <AutonomyToggle value={autonomy} onChange={updateAutonomy} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <PromptComposer
              value={prompt}
              onChange={setPrompt}
              onSubmit={startRun}
              disabled={isRunPending}
              disabledHint="Running… waiting for Claude to start"
              placeholder={
                autonomy === 'Autonomous'
                  ? 'ask Claude to do something…'
                  : 'ask Claude to plan something…'
              }
            />
            <button
              onClick={() => startRun()}
              disabled={!prompt.trim() || isRunPending}
              style={{
                padding: '8px 18px',
                backgroundColor: prompt.trim() && !isRunPending ? 'var(--accent-primary)' : 'var(--bg-overlay)',
                color: prompt.trim() && !isRunPending ? 'var(--bg-base)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: 6,
                cursor: prompt.trim() && !isRunPending ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: '0.02em',
                boxShadow: prompt.trim() && !isRunPending ? 'var(--glow-accent)' : 'none',
                opacity: prompt.trim() && !isRunPending ? 1 : ('var(--disabled-opacity)' as unknown as number),
                transition: 'box-shadow 160ms, background 160ms',
              }}
            >
              {autonomy === 'Autonomous' ? 'Run' : 'Plan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Autonomy toggle ---

function AutonomyToggle({
  value,
  onChange,
}: {
  value: AutonomyLevel;
  onChange: (v: AutonomyLevel) => void;
}) {
  const options: { value: AutonomyLevel; label: string; hint: string; Icon: typeof Bot }[] = [
    { value: 'Autonomous', label: 'Autonomous', hint: 'Claude edits files freely · review diff at end', Icon: Bot },
    { value: 'ReviewPlan', label: 'Plan first', hint: 'Claude writes a plan · you approve before execution', Icon: Eye },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        Autonomy
      </span>
      <div
        role="radiogroup"
        aria-label="Autonomy level"
        style={{
          display: 'inline-flex',
          padding: 2,
          borderRadius: 8,
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          gap: 2,
        }}
      >
        {options.map(({ value: optValue, label, hint, Icon }) => {
          const active = value === optValue;
          return (
            <button
              key={optValue}
              role="radio"
              aria-checked={active}
              onClick={() => onChange(optValue)}
              title={hint}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                fontFamily: 'var(--font-display)',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                letterSpacing: '0.01em',
                color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                background: active ? 'var(--accent-primary-15)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: active ? 'var(--glow-accent)' : 'none',
                transition: 'background 160ms var(--ease-out-expo), color 160ms, box-shadow 200ms',
              }}
            >
              <Icon size={12} strokeWidth={2} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Preflight error banner ---

function PreflightBanner({
  reason,
  suggestion,
  onDismiss,
}: {
  reason: string;
  suggestion: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        margin: '10px 14px 0',
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        borderRadius: 8,
        border: '1px solid var(--accent-error)',
        background: 'rgba(var(--accent-error-rgb), 0.08)',
        boxShadow: 'var(--glow-error)',
      }}
    >
      <AlertTriangle
        size={16}
        strokeWidth={2}
        style={{ color: 'var(--accent-error)', flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.02em',
            color: 'var(--accent-error)',
            marginBottom: 2,
          }}
        >
          Claude Code not ready
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
          }}
        >
          {reason}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 11,
            color: 'var(--text-secondary)',
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {suggestion}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

// Register with the pane registry
registerPane('AiRun', AiRunPane);
