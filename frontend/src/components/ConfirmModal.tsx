// ConfirmModal — a small, generic "are you sure" dialog.
//
// Extracted rather than copied from DirtyWarningModal, which is specific to the
// dirty-worktree prompt (it lists files, it offers stash-vs-run-anyway). This
// one only needs a title, a body and two buttons, and is used where an action
// destroys something the user assembled by hand.

import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open so the dialog is keyboard-reachable, and
  // let Escape dismiss it — a modal you can only leave with the mouse is a trap.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={titleStyle}>{title}</div>
        <div style={bodyStyle}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button onClick={onCancel} style={cancelBtnStyle}>{cancelLabel}</button>
          <button ref={confirmRef} onClick={onConfirm} style={confirmBtnStyle}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'var(--scrim)',
  // A dark scrim over an already-dark app dims almost nothing on its own — the
  // blur is what actually separates the dialog from the surface behind it.
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  width: 420,
  maxWidth: 'calc(100vw - 32px)',
  backgroundColor: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: 20,
  boxShadow: 'var(--shadow-overlay)',
  fontFamily: 'var(--font-display)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-title)',
  fontWeight: 600,
  color: 'var(--text-primary)',
  letterSpacing: '-0.01em',
};

const bodyStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 'var(--font-size-body)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

const btnBase: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 550,
  fontFamily: 'var(--font-display)',
  cursor: 'pointer',
};

const cancelBtnStyle: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-default)',
  color: 'var(--text-secondary)',
};

const confirmBtnStyle: React.CSSProperties = {
  ...btnBase,
  background: 'var(--accent-primary)',
  border: 'none',
  color: 'var(--accent-fg)',
};
