// MobilePaneSwitcher — a bottom tab strip for the panes.
//
// A phone shows one pane at a time (the split grid is not drawn), so this is
// how you move between them: a terminal, an AI run, a diff. It is only
// rendered when more than one pane exists — with a single pane it would be
// chrome with nothing to choose.
//
// Panes stay mounted while hidden, so switching preserves scrollback and run
// output; this strip only changes which id PaneRenderer treats as visible.

import { PANE_LABELS } from '../panes/labels';

export interface SwitcherPane {
  id: string;
  kind: string;
  label?: string;
  resource_id?: string | null;
}

interface MobilePaneSwitcherProps {
  panes: SwitcherPane[];
  focusedPaneId: string | null;
  onSelect: (id: string) => void;
}

export function MobilePaneSwitcher({ panes, focusedPaneId, onSelect }: MobilePaneSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="Panes"
      className="mobile-scroll safe-area-bottom"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: 4,
        padding: '6px 8px',
        borderTop: '1px solid var(--tint-border)',
        background: 'var(--bg-surface)',
        overflowX: 'auto',
        fontFamily: 'var(--font-display)',
      }}
    >
      {panes.map((pane, index) => {
        const isActive = pane.id === focusedPaneId;
        const label = pane.label || PANE_LABELS[pane.kind] || pane.kind;
        return (
          <button
            key={pane.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(pane.id)}
            title={label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              flex: '1 0 auto',
              maxWidth: 200,
              height: 36,
              padding: '0 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              background: isActive ? 'var(--tint-active)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: isActive ? 600 : 500,
              fontSize: 'var(--font-size-small)',
              fontFamily: 'var(--font-display)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-micro)',
              fontWeight: 700,
              color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
            }}>
              {index + 1}
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}