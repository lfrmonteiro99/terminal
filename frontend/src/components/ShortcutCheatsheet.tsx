// Keyboard shortcut cheatsheet overlay — triggered by Ctrl+/ or command palette

import { getShortcut } from '../core/shortcutMap';

interface ShortcutEntry {
  id?: string;
  keys?: string;
  description: string;
}

interface Category {
  name: string;
  shortcuts: ShortcutEntry[];
}

const CATEGORIES: Category[] = [
  {
    name: 'Navigation',
    shortcuts: [
      { keys: 'Ctrl+K', description: 'Open command palette' },
      { keys: 'Alt+Arrow', description: 'Navigate between panes' },
      { keys: 'Ctrl+1..9', description: 'Jump to pane by index' },
      { keys: 'Ctrl+/', description: 'Show keyboard shortcuts' },
    ],
  },
  {
    name: 'Panes',
    shortcuts: [
      { id: 'pane:split-right', description: 'Split pane right' },
      { id: 'pane:split-down', description: 'Split pane down' },
      { keys: 'Ctrl+Shift+Z', description: 'Zoom/restore pane' },
    ],
  },
  {
    name: 'Sidebar',
    shortcuts: [
      { id: 'sidebar:toggle', description: 'Toggle sidebar' },
      { id: 'sidebar:explorer', description: 'Explorer view' },
      { id: 'sidebar:changes', description: 'Changes view' },
      { id: 'sidebar:git', description: 'Git view' },
    ],
  },
  {
    name: 'Git',
    shortcuts: [
      { id: 'git:refresh', description: 'Refresh git status' },
      { id: 'git:push', description: 'Push branch' },
      { id: 'git:pull', description: 'Pull branch' },
      { id: 'git:fetch', description: 'Fetch remote' },
    ],
  },
  {
    name: 'Layout',
    shortcuts: [
      { id: 'layout:terminal', description: 'Terminal focus layout' },
      { id: 'layout:ai', description: 'AI session layout' },
      { id: 'layout:git', description: 'Git review layout' },
      { id: 'layout:browser', description: 'Browser + terminal layout' },
    ],
  },
];

function resolveKeys(entry: ShortcutEntry): string {
  if (entry.keys) return entry.keys;
  if (entry.id) return getShortcut(entry.id);
  return '';
}

function KeyBadges({ combo }: { combo: string }) {
  if (!combo) {
    return (
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', fontStyle: 'italic' }}>
        unbound
      </span>
    );
  }
  const parts = combo.split('+');
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      {parts.map((part, i) => (
        <kbd
          key={i}
          style={{
            display: 'inline-block',
            padding: '1px 5px',
            fontSize: 10,
            fontFamily: 'monospace',
            fontStyle: 'normal',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--bg-base)',
            border: '1px solid var(--border-default)',
            borderBottom: '2px solid var(--border-default)',
            borderRadius: 4,
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
          }}
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

interface ShortcutCheatsheetProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutCheatsheet({ open, onClose }: ShortcutCheatsheetProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-raised)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          maxWidth: 700,
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)', fontFamily: 'monospace', fontWeight: 600 }}>
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '2px 6px',
              borderRadius: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Categories grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {CATEGORIES.map((category) => (
            <div key={category.name}>
              <h3 style={{
                margin: '0 0 10px 0',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent, #7c9ef8)',
              }}>
                {category.name}
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px 16px',
              }}>
                {category.shortcuts.map((entry, idx) => {
                  const keys = resolveKeys(entry);
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 8px',
                        borderRadius: 6,
                        backgroundColor: 'var(--bg-surface)',
                        gap: 8,
                      }}
                    >
                      <span style={{
                        fontSize: 12,
                        color: 'var(--text-secondary, var(--text-primary))',
                        fontFamily: 'monospace',
                        flexShrink: 0,
                        flex: 1,
                      }}>
                        {entry.description}
                      </span>
                      <KeyBadges combo={keys} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{
          marginTop: 20,
          paddingTop: 12,
          borderTop: '1px solid var(--border-default)',
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'monospace',
          textAlign: 'center',
        }}>
          Press <KeyBadges combo="Escape" /> or <KeyBadges combo="Ctrl+/" /> to close
        </div>
      </div>
    </div>
  );
}
