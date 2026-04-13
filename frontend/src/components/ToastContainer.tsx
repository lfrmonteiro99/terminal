// ToastContainer — bottom-right toast notifications for background terminal commands

import { useEffect, useState } from 'react';

interface Toast {
  id: string;
  paneId: string;
  paneLabel: string;
  message: string;
  timestamp: number;
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Listen for terminal-notification custom events
  useEffect(() => {
    const handler = (e: Event) => {
      const { paneId, paneLabel, message } = (e as CustomEvent).detail;
      setToasts(prev => {
        const next = [
          ...prev,
          {
            id: crypto.randomUUID(),
            paneId,
            paneLabel,
            message,
            timestamp: Date.now(),
          },
        ];
        return next.slice(-3); // max 3 visible
      });
    };
    window.addEventListener('terminal-notification', handler);
    return () => window.removeEventListener('terminal-notification', handler);
  }, []);

  // Auto-dismiss after 5s
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      setToasts(prev => prev.filter(t => Date.now() - t.timestamp < 5000));
    }, 500);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismiss = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const jumpToPane = (paneId: string, id: string) => {
    window.dispatchEvent(new CustomEvent('focus-pane', { detail: { paneId } }));
    dismiss(id);
  };

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{
            backgroundColor: 'var(--bg-glass)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid var(--glass-border)',
            borderLeft: '3px solid var(--accent-primary)',
            borderRadius: 8,
            padding: '10px 14px',
            boxShadow: 'var(--shadow-toast), var(--glow-accent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minWidth: 240,
            maxWidth: 320,
            pointerEvents: 'all',
            animation: 'toast-slide-in 220ms var(--ease-out-expo)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-display)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                letterSpacing: '0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {toast.paneLabel}
            </span>
            <button
              onClick={() => dismiss(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 0,
                flexShrink: 0,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-muted)',
            }}
          >
            {toast.message}
          </span>
          <button
            onClick={() => jumpToPane(toast.paneId, toast.id)}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 12px',
              backgroundColor: 'var(--accent-primary)',
              color: 'var(--bg-base)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              letterSpacing: '0.02em',
              boxShadow: 'var(--glow-accent)',
            }}
          >
            Jump
          </button>
        </div>
      ))}

      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(24px) scale(0.96); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
