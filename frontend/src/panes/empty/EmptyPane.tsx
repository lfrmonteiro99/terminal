// EmptyPane — placeholder pane that lets users pick what to create here

import { TerminalSquare, Bot, Globe, GitBranch, History } from 'lucide-react';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

const PANE_OPTIONS = [
  { kind: 'Terminal', label: 'Terminal', Icon: TerminalSquare, description: 'Shell session' },
  { kind: 'AiRun', label: 'AI Run', Icon: Bot, description: 'AI prompt & output' },
  { kind: 'Browser', label: 'Browser', Icon: Globe, description: 'Embedded browser' },
  { kind: 'GitStatus', label: 'Git Status', Icon: GitBranch, description: 'Staging & commits' },
  { kind: 'GitHistory', label: 'Git History', Icon: History, description: 'Commit log' },
];

export function EmptyPane({ pane }: PaneProps) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'var(--bg-surface)', gap: 24,
    }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-chrome)' }}>
        Choose a pane type
      </span>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12, maxWidth: 360,
      }}>
        {PANE_OPTIONS.map(({ kind, label, Icon, description }) => (
          <button
            key={kind}
            onClick={() => {
              // Dispatch a custom event that App.tsx listens for to replace this pane
              window.dispatchEvent(new CustomEvent('set-pane-type', {
                detail: { paneId: pane.id, kind },
              }));
            }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              padding: '16px 12px', backgroundColor: 'var(--bg-raised)',
              border: '1px solid var(--border-default)', borderRadius: 8,
              cursor: 'pointer', color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-chrome)',
              transition: 'border-color 120ms, background-color 120ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
              e.currentTarget.style.backgroundColor = 'var(--bg-overlay)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
              e.currentTarget.style.backgroundColor = 'var(--bg-raised)';
            }}
          >
            <Icon size={24} strokeWidth={1.5} />
            <span style={{ fontWeight: 500 }}>{label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

registerPane('Empty', EmptyPane);
