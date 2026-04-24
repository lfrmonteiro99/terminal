// PromptComposer — auto-growing textarea for AI run prompts (AI-UX-01)

import { useLayoutEffect, useRef } from 'react';

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
}

function lineHeightPx(el: HTMLTextAreaElement): number {
  const styles = window.getComputedStyle(el);
  const fontSize = Number.parseFloat(styles.fontSize) || 13;
  const lineHeight = Number.parseFloat(styles.lineHeight);

  if (!Number.isFinite(lineHeight)) {
    return fontSize * 1.55;
  }

  // JSDOM and some browsers can expose unitless line-height values.
  return lineHeight <= fontSize ? lineHeight * fontSize : lineHeight;
}

export function PromptComposer({ value, onChange, onSubmit, placeholder, disabled, disabledHint }: PromptComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit content, capped at 12 rows.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.style.height = 'auto';
    const maxHeight = lineHeightPx(el) * 12;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '9px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.55,
          backgroundColor: 'var(--bg-raised)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: 6,
          outline: 'none',
          resize: 'none',
          overflowX: 'hidden',
          transition: 'border-color 120ms, box-shadow 120ms',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent-primary)';
          e.currentTarget.style.boxShadow = 'var(--glow-accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-default)';
          e.currentTarget.style.boxShadow = 'none';
        }}
      />
      {disabled && disabledHint && (
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'var(--text-secondary)' }}>
          {disabledHint}
        </div>
      )}
      {value.length > 400 && (
        <div
          aria-live="polite"
          style={{
            alignSelf: 'flex-end',
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            color: 'var(--text-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {value.length} chars
        </div>
      )}
    </div>
  );
}
