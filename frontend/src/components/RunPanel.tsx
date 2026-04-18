import { useEffect, useRef } from 'react';
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
import type { ToolCall } from '../types/protocol';

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

export function RunPanel() {
  const state = useAppState();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.outputLines.length, state.runToolCalls.size]);

  const toolCalls = Array.from(state.runToolCalls.values());
  const lines = state.outputLines.filter(shouldRenderLine);

  if (state.activeRun && lines.length === 0 && toolCalls.length === 0) {
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
        aria-label="Preparing run"
        aria-busy="true"
      >
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
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '14px 18px',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: 1.55,
        backgroundColor: 'var(--bg-surface)',
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
            {line}
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
  );
}
