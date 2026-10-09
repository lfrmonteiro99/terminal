// ErrorBanner — the one place *app-level* `Error` events become visible.
//
// Only app-level failures arrive here now: a rejected auth, a session whose
// project root vanished, a failed terminal restore. Failures about a single run
// travel as `RunError` and render beside the run they concern (RunErrorNotice).
// They used to land here, and a full-width red bar across the top read as "the
// app broke" for something as ordinary as a worktree that had already been
// merged — while burying the one fact that mattered, which run.
//
// The reducer hands us `${code}: ${message}`. Splitting it back apart is what
// lets the code read as a code and the sentence read as a sentence, instead of
// one run-on string in a monospace font.

import { AlertTriangle, X } from 'lucide-react';

interface ErrorBannerProps {
  /** Formatted as `${code}: ${message}` by the reducer. */
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  // `> 0` and not `>= 0`: a message that itself starts with ": " keeps whole.
  const splitAt = message.indexOf(': ');
  const code = splitAt > 0 ? message.slice(0, splitAt) : null;
  const body = splitAt > 0 ? message.slice(splitAt + 2) : message;

  return (
    <div
      role="alert"
      data-error-banner
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '9px 14px',
        borderBottom: '1px solid var(--accent-error)',
        background: 'rgba(var(--accent-error-rgb), 0.08)',
        flexShrink: 0,
      }}
    >
      <AlertTriangle
        size={15}
        strokeWidth={2}
        style={{ color: 'var(--accent-error)', flexShrink: 0, marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: 'var(--font-size-micro)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--accent-error)',
            }}
          >
            Daemon
          </span>
          {code && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--font-size-micro)',
                color: 'var(--text-muted)',
              }}
            >
              {code}
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 'var(--font-size-small)',
            lineHeight: 1.5,
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
          }}
        >
          {body}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss error"
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
