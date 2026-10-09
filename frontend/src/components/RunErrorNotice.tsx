// RunErrorNotice — a failure about one run, shown next to the run.
//
// Deliberately NOT the app-level ErrorBanner. A run's worktree going missing
// does not mean the app broke, and a full-width red bar across the top says
// exactly that. Keeping the message beside the thing it is about also answers
// the real question — "which run?" — without making the user read a uuid.
//
// The daemon sends these as `RunError`, which carries the run id and a message
// already written for a human. Nothing here reformats or re-encodes them.

import { AlertTriangle, X } from 'lucide-react';

interface RunErrorNoticeProps {
  message: string;
  /** Omit to render it as a standing note that the surrounding action clears. */
  onDismiss?: () => void;
}

export function RunErrorNotice({ message, onDismiss }: RunErrorNoticeProps) {
  return (
    <div
      role="status"
      data-run-error-notice
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '8px 10px',
        borderRadius: 6,
        // A left rule rather than a flood of colour: this is a caveat about the
        // run, not an alarm about the app.
        background: 'rgba(var(--state-warning-rgb), 0.10)',
        borderLeft: '2px solid var(--state-warning)',
      }}
    >
      <AlertTriangle
        size={13}
        strokeWidth={2}
        style={{ color: 'var(--state-warning)', flexShrink: 0, marginTop: 1 }}
      />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--font-size-small)',
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          wordBreak: 'break-word',
        }}
      >
        {message}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            flexShrink: 0,
          }}
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
