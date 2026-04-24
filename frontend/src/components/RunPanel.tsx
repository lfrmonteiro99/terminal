import { useEffect, useRef, type ReactNode } from 'react';
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
} from 'lucide-react';
import { useAppState } from '../context/AppContext';
import { useSend } from '../context/SendContext';
import { CommandBus } from '../core/commands/commandBus';
import { RunService } from '../core/services/runService';
import type { ToolCall } from '../types/protocol';
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
      </button>
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

  const accent = isErr
    ? 'var(--accent-error)'
    : isPending
      ? 'var(--accent-primary)'
      : 'var(--accent-primary)';
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
        boxShadow: isPending ? 'var(--glow-accent)' : 'none',
        transition: 'box-shadow 200ms, border-color 200ms, background 200ms',
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
              style={{
                color: 'var(--accent-primary)',
                animation: 'glow-pulse 1.4s ease-in-out infinite',
                flexShrink: 0,
              }}
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
        padding: '6px 14px',
        backgroundColor: 'transparent',
        color: 'var(--accent-error)',
        border: '1px solid var(--accent-error)',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.02em',
      }}
    >
      Stop
    </button>
  );
}

export function RunPanel() {
  const state = useAppState();
  const send = useSend();
  const bottomRef = useRef<HTMLDivElement>(null);

  const stopRun = () => {
    if (!state.activeRun) return;
    new RunService(new CommandBus(send)).cancelRun(state.activeRun, 'User cancelled');
  };

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state.outputLines.length, state.runToolCalls.size]);

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

  const isThinking = (state.activeRun || state.pendingRunStartedAt) && lines.length === 0 && toolCalls.length === 0;

  if (isThinking) {
    return (
      <div
        style={{
          flex: 1,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          backgroundColor: 'var(--bg-surface)',
        }}
        aria-label="Claude is thinking"
        aria-busy="true"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)', fontSize: 13 }}>
            Claude is thinking…
          </div>
          {state.activeRun && <StopRunButton onStop={stopRun} />}
        </div>
        {[100, 72, 88].map((w, i) => (
          <div
            key={i}
            style={{
              height: 12,
              width: `${w}%`,
              borderRadius: 4,
              background: 'var(--bg-overlay)',
              animation: `skeleton-shimmer 1.6s ${i * 0.15}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  if (!state.activeRun && lines.length === 0 && toolCalls.length === 0) {
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
            boxShadow: '0 0 14px rgba(var(--accent-primary-rgb), 0.25)',
          }}
        />
        <div>no active run</div>
        <div style={{ fontSize: 11, opacity: 0.7 }}>start a session, then run a prompt</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-surface)' }}>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '14px 18px',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--text-primary)',
        }}
      >
      {toolCalls.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {toolCalls.map((call) => (
            <ToolCallCard key={call.tool_id} call={call} />
          ))}
        </div>
      )}

      {lines.map((line, i) => {
        const isStderr = line.startsWith('[stderr]');
        return (
          <div
            key={i}
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: isStderr ? 'var(--accent-error)' : 'var(--text-primary)',
              opacity: isStderr ? 0.95 : 1,
            }}
          >
            {renderLineWithFileLinks(line)}
          </div>
        );
      })}

      {state.activeRun && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--accent-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            letterSpacing: '0.02em',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 8,
              height: 16,
              background: 'var(--accent-primary)',
              borderRadius: 1,
              animation: 'glow-pulse 1.4s ease-in-out infinite',
            }}
          />
          <span style={{ opacity: 0.85 }}>running</span>
        </div>
      )}
        <div ref={bottomRef} />
      </div>
      {state.activeRun && (
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--border-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--bg-surface)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontSize: 12 }}>
            Running… press Esc or Ctrl+. to stop
          </span>
          <StopRunButton onStop={stopRun} />
        </div>
      )}
    </div>
  );
}
