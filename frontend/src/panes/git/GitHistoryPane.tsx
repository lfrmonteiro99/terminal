// GitHistoryPane — commit history with branch actions (M5-01, M5-03)

import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { useSend } from '../../context/SendContext';
import { useAppState } from '../../context/AppContext';
import { registerPane } from '../registry';
import type { PaneProps } from '../registry';

// Muted author palette — keeps the rail calm, not rainbow-loud.
const AUTHOR_PALETTE = [
  '#7aa2f7', // blue
  '#b48ead', // mauve
  '#e5a33d', // gold
  '#9ccfd8', // sea
  '#c4a7e7', // lilac
  '#e0af68', // ochre
];

function hashAuthor(author: string): number {
  let h = 0;
  for (let i = 0; i < author.length; i++) h = (h * 31 + author.charCodeAt(i)) >>> 0;
  return h % AUTHOR_PALETTE.length;
}

function authorColor(author: string): string {
  return AUTHOR_PALETTE[hashAuthor(author)];
}

function authorInitial(author: string): string {
  const trimmed = author.trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

export function GitHistoryPane({ pane: _pane }: PaneProps) {
  const send = useSend();
  const state = useAppState();

  useEffect(() => {
    send({ type: 'GetCommitHistory', limit: 50 });
  }, [send]);

  const commits = state.commitHistory;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
      }}
    >
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-default)',
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span>Commit History</span>
        <button
          onClick={() => send({ type: 'GetCommitHistory', limit: 50 })}
          title="Refresh"
          aria-label="Refresh commit history"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            background: 'transparent',
            border: '1px solid var(--border-default)',
            color: 'var(--text-muted)',
            borderRadius: 4,
            cursor: 'pointer',
            padding: 0,
            transition: 'color 140ms, border-color 140ms, background 140ms',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--accent-primary)';
            e.currentTarget.style.borderColor = 'var(--accent-primary)';
            e.currentTarget.style.background = 'var(--accent-primary-08)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-muted)';
            e.currentTarget.style.borderColor = 'var(--border-default)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <RotateCw size={12} strokeWidth={1.75} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {commits.length === 0 ? (
          <CommitSkeleton />
        ) : (
          <div style={{ position: 'relative' }}>
            {/* Vertical rail */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 24,
                top: 14,
                bottom: 14,
                width: 2,
                background: 'rgba(var(--accent-primary-rgb), 0.28)',
                borderRadius: 1,
              }}
            />
            {commits.map((commit) => (
              <div
                key={commit.hash}
                style={{
                  position: 'relative',
                  padding: '10px 12px 10px 44px',
                  borderBottom: '1px solid var(--border-default)',
                  fontSize: 12,
                }}
              >
                {/* Rail node (author avatar) */}
                <div
                  style={{
                    position: 'absolute',
                    left: 14,
                    top: 12,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: authorColor(commit.author),
                    color: 'var(--bg-base)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 11,
                    boxShadow: '0 0 0 3px var(--bg-surface)',
                  }}
                  title={commit.author}
                >
                  {authorInitial(commit.author)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      color: 'var(--accent-warn)',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      padding: '1px 5px',
                      border: '1px solid rgba(var(--accent-warn-rgb), 0.3)',
                      borderRadius: 3,
                      background: 'rgba(var(--accent-warn-rgb), 0.08)',
                    }}
                  >
                    {commit.hash.slice(0, 7)}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    {commit.author}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      marginLeft: 'auto',
                    }}
                  >
                    {commit.date}
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    wordBreak: 'break-word',
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    lineHeight: 1.4,
                  }}
                >
                  {commit.message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CommitSkeleton() {
  const rows = [0, 1, 2, 3];
  return (
    <div style={{ position: 'relative', padding: 0 }}>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 24,
          top: 14,
          bottom: 14,
          width: 2,
          background: 'rgba(var(--accent-primary-rgb), 0.15)',
          borderRadius: 1,
        }}
      />
      {rows.map((i) => (
        <div
          key={i}
          style={{
            position: 'relative',
            padding: '12px 12px 12px 44px',
            borderBottom: '1px solid var(--border-default)',
          }}
        >
          <div
            className="anim-shimmer"
            style={{
              position: 'absolute',
              left: 14,
              top: 12,
              width: 22,
              height: 22,
              borderRadius: '50%',
            }}
          />
          <div
            className="anim-shimmer"
            style={{ height: 10, width: '40%', borderRadius: 4, marginBottom: 8 }}
          />
          <div
            className="anim-shimmer"
            style={{ height: 12, width: `${70 - i * 10}%`, borderRadius: 4 }}
          />
        </div>
      ))}
    </div>
  );
}

registerPane('GitHistory', GitHistoryPane);
