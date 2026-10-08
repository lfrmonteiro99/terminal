import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Edit3,
  FileText,
  FilePlus,
  Terminal as TerminalIcon,
  Search,
  Globe,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader,
  AlertTriangle,
  Info,
  ArrowDown,
} from 'lucide-react';
import { useAppState } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import { CommandBus } from '../core/commands/commandBus';
import { RunService } from '../core/services/runService';
import type { NoticeLevel, RunNotice, ToolCall } from '../types/protocol';
import { extractFileLineRefs } from './runPanelFileLinks';

function openFileViewer(path: string): void {
  window.dispatchEvent(new CustomEvent('open-file-viewer', { detail: { path } }));
}

function renderLineWithFileLinks(line: string): ReactNode {
  const refs = extractFileLineRefs(line);
  if (refs.length === 0) return line;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) nodes.push(line.slice(cursor, ref.start));
    nodes.push(
      <button
        key={`${ref.path}:${ref.line}:${ref.start}`}
        onClick={() => openFileViewer(ref.path)}
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          color: 'var(--accent-primary)',
          textDecoration: 'underline',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
        }}
        title={`Open ${ref.path} (line ${ref.line})`}
      >
        {line.slice(ref.start, ref.end)}
      </button>,
    );
    cursor = ref.end;
  }
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

/** Render a lucide icon for common Claude Code tool names. Rendered inline
 * (rather than assigning the component to a local `Icon`) so React's
 * static-component rule doesn't flag it. */
function renderToolIcon(name: string, size: number) {
  const props = { size, strokeWidth: 2 };
  switch (name) {
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return <Edit3 {...props} />;
    case 'Write':
      return <FilePlus {...props} />;
    case 'Read':
      return <FileText {...props} />;
    case 'Bash':
      return <TerminalIcon {...props} />;
    case 'Grep':
    case 'Glob':
    case 'Search':
      return <Search {...props} />;
    case 'WebFetch':
    case 'WebSearch':
      return <Globe {...props} />;
    default:
      return <Wrench {...props} />;
  }
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const isErr = call.status === 'error';
  const isPending = call.status === 'pending';

  const accent = isErr ? 'var(--accent-error)' : 'var(--accent-primary)';
  const bg = isErr
    ? 'rgba(var(--accent-error-rgb), 0.08)'
    : isPending
      ? 'rgba(var(--accent-primary-rgb), 0.06)'
      : 'rgba(var(--accent-primary-rgb), 0.04)';
  const border = isErr
    ? 'rgba(var(--accent-error-rgb), 0.35)'
    : isPending
      ? 'rgba(var(--accent-primary-rgb), 0.35)'
      : 'var(--border-default)';

  return (
    <div
      className="anim-fade-in-up"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 12px',
        margin: '4px 0',
        borderRadius: 6,
        border: `1px solid ${border}`,
        background: bg,
        fontFamily: 'var(--font-display)',
        transition: 'border-color 200ms, background 200ms',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: 5,
          background: 'var(--bg-surface)',
          color: accent,
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {renderToolIcon(call.tool_name, 13)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: 'var(--text-primary)',
          }}
        >
          <span>{call.tool_name}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 400,
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={call.input_preview}
          >
            {call.input_preview}
          </span>
          {isPending ? (
            <Loader
              size={12}
              strokeWidth={2}
              style={{ color: 'var(--accent-primary)', animation: 'glow-pulse 1.4s ease-in-out infinite', flexShrink: 0 }}
            />
          ) : isErr ? (
            <XCircle size={13} strokeWidth={2} style={{ color: 'var(--accent-error)', flexShrink: 0 }} />
          ) : (
            <CheckCircle2
              size={13}
              strokeWidth={2}
              className="anim-check-pop"
              style={{ color: 'var(--accent-primary)', flexShrink: 0 }}
            />
          )}
        </div>
        {call.result_preview && (
          <div
            style={{
              marginTop: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: isErr ? 'var(--accent-error)' : 'var(--text-secondary)',
              opacity: 0.9,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={call.result_preview}
          >
            {isErr ? '✗ ' : '→ '}
            {call.result_preview}
          </div>
        )}
      </div>
    </div>
  );
}

/** Filter out the `▸ tool:` / `◂ tool result` log lines — they're represented
 * by the structured ToolCallCard list above, so showing them twice is noise. */
function shouldRenderLine(line: string): boolean {
  return !(line.startsWith('▸ tool:') || line.startsWith('◂ tool result'));
}

function StopRunButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      aria-label="Stop run"
      title="Stop run (Esc or Ctrl+.)"
      style={{
        padding: '5px 12px',
        backgroundColor: 'transparent',
        color: 'var(--accent-error)',
        border: '1px solid var(--accent-error)',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      Stop
    </button>
  );
}

/** What each supervisor phase means, in the user's terms rather than ours. */
const PHASE_LABEL: Record<string, string> = {
  preparing: 'Preparing workspace',
  worktree: 'Creating an isolated worktree',
  preflight: 'Checking the runner',
  streaming: 'Model is working',
  finalising: 'Collecting what changed',
};

const NOTICE_STYLE: Record<NoticeLevel, { color: string; bg: string; border: string }> = {
  Info: {
    color: 'var(--text-secondary)',
    bg: 'var(--bg-overlay)',
    border: 'var(--border-default)',
  },
  Warning: {
    color: 'var(--state-warning)',
    bg: 'rgba(var(--state-warning-rgb), 0.10)',
    border: 'rgba(var(--state-warning-rgb), 0.35)',
  },
  Error: {
    color: 'var(--accent-error)',
    bg: 'rgba(var(--accent-error-rgb), 0.10)',
    border: 'rgba(var(--accent-error-rgb), 0.40)',
  },
};

function NoticeRow({ notice }: { notice: RunNotice }) {
  const s = NOTICE_STYLE[notice.level] ?? NOTICE_STYLE.Info;
  const Icon = notice.level === 'Error' ? XCircle : notice.level === 'Warning' ? AlertTriangle : Info;
  return (
    <div
      className="anim-fade-in-up"
      role={notice.level === 'Error' ? 'alert' : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '7px 11px',
        margin: '4px 0',
        borderRadius: 6,
        border: `1px solid ${s.border}`,
        background: s.bg,
        color: s.color,
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <Icon size={13} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{notice.message}</span>
    </div>
  );
}

function elapsedLabel(startedAt: number | null, now: number): string {
  if (!startedAt) return '';
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  return `${mins}m ${rest.toString().padStart(2, '0')}s`;
}

export function RunPanel() {
  const state = useAppState();
  const send = useSend();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  // Auto-follow is a preference, not a law: scrolling up to read must not be
  // yanked back to the bottom by the next token.
  const [following, setFollowing] = useState(true);

  const stopRun = () => {
    if (!state.activeRun) return;
    new RunService(new CommandBus(send)).cancelRun(state.activeRun, 'User cancelled');
  };

  const isActive = state.activeRun !== null || state.pendingRunStartedAt !== null;

  // A ticking clock is the cheapest honest liveness signal: while a model
  // thinks, the seconds still move, so the panel never looks frozen.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  useEffect(() => {
    if (!state.activeRun) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const stopShortcut = event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === '.');
      if (!stopShortcut) return;
      event.preventDefault();
      new RunService(new CommandBus(send)).cancelRun(state.activeRun!, 'User cancelled');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send, state.activeRun]);

  const toolCalls = Array.from(state.runToolCalls.values());
  const lines = state.outputLines.filter(shouldRenderLine);
  const hasOutput = lines.length > 0 || toolCalls.length > 0 || state.runLiveText.length > 0;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 40px of slack: "at the bottom" should tolerate a slightly short scroll.
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  // Layout effect, not passive: the scroll must happen in the same frame the new
  // line paints, or a fast stream visibly lags behind.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !following) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length, toolCalls.length, state.runLiveText, state.runNotices.length, following]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
  };

  // Consecutive duplicates are noise: a rate-limit notice can repeat per turn.
  const notices = state.runNotices.filter(
    (n, i, all) => i === 0 || all[i - 1].message !== n.message || all[i - 1].level !== n.level,
  );

  if (!isActive && !hasOutput) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 24,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          letterSpacing: '0.01em',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--accent-primary)',
            opacity: 0.35,
          }}
        />
        <div>no active run</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>start a session, then run a prompt</div>
      </div>
    );
  }

  // "Working but silent" is the state that used to look broken. The header
  // already names the phase, so the body only has to say *why* there is nothing
  // yet — repeating the phase here just said the same thing twice.
  const showWaitingState = isActive && !hasOutput;
  const waitingLabel =
    state.runPhase === 'streaming'
      ? 'Model is working'
      : state.runState?.type === 'Preparing'
        ? 'Preparing the run'
        : 'Waiting for the first token';

  // Human name for the current supervisor phase, for the status header.
  const phaseText = state.runPhase ? (PHASE_LABEL[state.runPhase] ?? state.runPhase) : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface)' }}>
      {/* Status header: always answers "is it doing anything?" while a run is live. */}
      {isActive && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 14px',
            borderBottom: '1px solid var(--border-default)',
            background: 'var(--bg-base)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--accent-primary)',
              animation: 'glow-pulse 1.4s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {state.runPhase === 'streaming' ? 'Generating' : (phaseText ?? 'Running')}
          </span>
          {state.runPhaseDetail && (
            <span
              style={{
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '38ch',
              }}
              title={state.runPhaseDetail}
            >
              {state.runPhaseDetail}
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {elapsedLabel(state.runStartedAt, now)}
          </span>
          <StopRunButton onStop={stopRun} />
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          position: 'relative',
        }}
      >
        {notices.length > 0 && (
          <div style={{ marginBottom: 10 }} role="log" aria-label="Run notices">
            {notices.map((n, i) => (
              <NoticeRow key={`${n.at}-${i}`} notice={n} />
            ))}
          </div>
        )}

        {toolCalls.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {toolCalls.map((call) => (
              <ToolCallCard key={call.tool_id} call={call} />
            ))}
          </div>
        )}

        {lines.map((line, i) => {
          // stderr from a CLI is diagnostics, not failure — colouring all of it
          // red made every run look like it was erroring.
          const isStderr = line.startsWith('[stderr]');
          return (
            <div
              key={i}
              style={{
                whiteSpace: 'pre-wrap',
                // `break-word`, not `break-all`: break-all splits ordinary words
                // mid-syllable, which is what made long lines unreadable.
                overflowWrap: 'anywhere',
                color: isStderr ? 'var(--text-muted)' : 'var(--text-primary)',
                fontSize: isStderr ? 12 : undefined,
              }}
            >
              {renderLineWithFileLinks(line)}
            </div>
          );
        })}

        {/* Live token stream. Replaced by the committed text above as soon as
            the block finishes, so nothing is ever shown twice. */}
        {state.runLiveText.length > 0 && (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              color: 'var(--text-primary)',
            }}
          >
            {renderLineWithFileLinks(state.runLiveText)}
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 7,
                height: 14,
                marginLeft: 1,
                verticalAlign: '-2px',
                background: 'var(--accent-primary)',
                animation: 'glow-pulse 1s ease-in-out infinite',
              }}
            />
          </div>
        )}

        {showWaitingState && (
          <div
            aria-busy="true"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              paddingTop: 6,
              fontFamily: 'var(--font-display)',
            }}
          >
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {waitingLabel}
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}
                — no output yet, the model has not started replying
              </span>
            </div>
            {[92, 64, 78].map((w, i) => (
              <div
                key={i}
                style={{
                  height: 10,
                  width: `${w}%`,
                  borderRadius: 4,
                  background: 'var(--bg-overlay)',
                  animation: `skeleton-shimmer 1.6s ${i * 0.15}s ease-in-out infinite`,
                }}
              />
            ))}
          </div>
        )}

        {!following && hasOutput && (
          <div style={{ height: 28 }} aria-hidden="true" />
        )}
      </div>

      {/* Footer: metrics when the runner reported them, plus a way back to the
          tail when the user has scrolled up to read. */}
      <div
        style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--bg-surface)',
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {state.runMetrics ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {state.runMetrics.num_turns} {state.runMetrics.num_turns === 1 ? 'turn' : 'turns'} ·{' '}
            {state.runMetrics.input_tokens.toLocaleString()} in /{' '}
            {state.runMetrics.output_tokens.toLocaleString()} out
            {state.runMetrics.cost_usd > 0 ? ` · $${state.runMetrics.cost_usd.toFixed(3)}` : ''}
          </span>
        ) : (
          <span>{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
        )}

        {isActive && (
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
            Esc or Ctrl+. to stop
          </span>
        )}

        {!following && hasOutput && (
          <button
            type="button"
            onClick={jumpToLatest}
            style={{
              position: 'absolute',
              right: 14,
              top: -34,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 999,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              fontWeight: 600,
              boxShadow: 'var(--shadow-elevated)',
            }}
          >
            <ArrowDown size={12} strokeWidth={2} />
            Latest
          </button>
        )}
      </div>
    </div>
  );
}
