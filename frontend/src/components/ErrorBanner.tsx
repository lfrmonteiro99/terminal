// ErrorBanner — the one place daemon-level `Error` events become visible.
//
// Before this, an `Error` event only set `state.error` in the reducer and
// nothing rendered it. So RUN_ALREADY_ACTIVE, SESSION_NOT_FOUND,
// WORKING_DIR_BUSY and PROJECT_ROOT_MISSING all reached the client and were
// silently dropped: the user pressed Run and saw nothing happen, with no way to
// tell a busy directory from a missing one.

import { AlertTriangle, X } from 'lucide-react';

interface ErrorBannerProps {
  /** Already formatted as `${code}: ${message}` by the reducer. */
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
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
        background: 'rgba(var(--accent-error-rgb), 0.10)',
        flexShrink: 0,
      }}
    >
      <AlertTriangle
        size={15}
        strokeWidth={2}
        style={{ color: 'var(--accent-error)', flexShrink: 0, marginTop: 2 }}
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          wordBreak: 'break-word',
        }}
      >
        {message}
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
