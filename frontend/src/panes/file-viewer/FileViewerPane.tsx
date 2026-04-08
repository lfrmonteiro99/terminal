// FileViewerPane — read-only file viewer with line numbers (TERMINAL-005)

import { useEffect, useRef, useState } from 'react';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';
import { useSend } from '../../context/SendContext';

interface FileContentEvent {
  type: 'FileContent';
  path: string;
  content: string;
  language: string;
  truncated: boolean;
  size_bytes: number;
}

interface FileReadErrorEvent {
  type: 'FileReadError';
  path: string;
  error: string;
}

type State =
  | { status: 'empty' }
  | { status: 'loading'; path: string }
  | { status: 'loaded'; path: string; content: string; language: string; truncated: boolean; size_bytes: number }
  | { status: 'error'; path: string; error: string };

export function FileViewerPane({ pane }: PaneProps) {
  const send = useSend();
  const [state, setState] = useState<State>({ status: 'empty' });
  const pathRef = useRef<string | null>(null);

  // Send ReadFile when resource_id changes
  useEffect(() => {
    const path = pane.resource_id;
    if (!path) {
      setState({ status: 'empty' });
      return;
    }
    pathRef.current = path;
    setState({ status: 'loading', path });
    send({ type: 'ReadFile', path });
  }, [pane.resource_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for file-viewer-event dispatched from App.tsx
  useEffect(() => {
    const handler = (e: Event) => {
      const event = (e as CustomEvent).detail as FileContentEvent | FileReadErrorEvent;
      if (event.type === 'FileContent' && event.path === pathRef.current) {
        setState({
          status: 'loaded',
          path: event.path,
          content: event.content,
          language: event.language,
          truncated: event.truncated,
          size_bytes: event.size_bytes,
        });
      } else if (event.type === 'FileReadError' && event.path === pathRef.current) {
        setState({ status: 'error', path: event.path, error: event.error });
      }
    };
    window.addEventListener('file-viewer-event', handler);
    return () => window.removeEventListener('file-viewer-event', handler);
  }, []);

  const containerStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: 'var(--bg-surface)',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: 12,
  };

  const breadcrumbStyle: React.CSSProperties = {
    padding: '4px 10px',
    borderBottom: '1px solid var(--border-default)',
    fontSize: 11,
    color: 'var(--text-muted)',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    backgroundColor: 'var(--bg-overlay)',
  };

  const scrollAreaStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
  };

  if (state.status === 'empty') {
    return (
      <div style={containerStyle}>
        <div style={{ ...breadcrumbStyle }}>
          <span>No file selected</span>
        </div>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', fontSize: 13,
        }}>
          Double-click a file in the Explorer to view it here.
        </div>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={breadcrumbStyle}>
          <span style={{ color: 'var(--text-primary)' }}>{shortPath(state.path)}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading...
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div style={containerStyle}>
        <div style={breadcrumbStyle}>
          <span style={{ color: 'var(--text-primary)' }}>{shortPath(state.path)}</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: 'var(--accent-error, #e06c75)', fontSize: 13 }}>
          <span style={{ fontSize: 20 }}>⚠</span>
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  // Loaded
  const lines = state.content.split('\n');
  // Remove trailing empty line from split if content ends with \n
  if (lines[lines.length - 1] === '') lines.pop();

  return (
    <div style={containerStyle}>
      {/* Breadcrumb */}
      <div style={breadcrumbStyle}>
        {buildBreadcrumbs(state.path).map((segment, i, arr) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: i === arr.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {segment}
            </span>
            {i < arr.length - 1 && <span style={{ color: 'var(--text-muted)', opacity: 0.5 }}>/</span>}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
          {state.language}
          {state.truncated && <span style={{ color: 'var(--accent-warn, #e5c07b)', marginLeft: 8 }}>⚠ truncated</span>}
        </span>
      </div>

      {/* Code area */}
      <div style={scrollAreaStyle}>
        {/* Gutter */}
        <div
          aria-hidden="true"
          style={{
            flexShrink: 0,
            minWidth: gutterWidth(lines.length),
            padding: '4px 8px',
            textAlign: 'right',
            color: 'var(--text-muted)',
            borderRight: '1px solid var(--border-default)',
            backgroundColor: 'var(--bg-overlay)',
            userSelect: 'none',
            lineHeight: '1.5',
          }}
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Content */}
        <pre
          style={{
            flex: 1,
            margin: 0,
            padding: '4px 12px',
            color: 'var(--text-primary)',
            lineHeight: '1.5',
            whiteSpace: 'pre',
            overflowX: 'auto',
            backgroundColor: 'var(--bg-surface)',
            userSelect: 'text',
          }}
        >
          <code className={`language-${state.language}`}>
            {lines.map((line, i) => (
              <div key={i}>{line || '\u00A0'}</div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

function shortPath(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function buildBreadcrumbs(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  // Show last 4 segments to keep it short
  if (parts.length > 4) return ['...', ...parts.slice(-3)];
  return parts;
}

function gutterWidth(lineCount: number): number {
  const digits = String(lineCount).length;
  return Math.max(36, digits * 8 + 16);
}

registerPane('FileViewer', FileViewerPane);
