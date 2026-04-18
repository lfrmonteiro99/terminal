// PromptComposer — auto-growing textarea for AI run prompts (AI-UX-01)

import { useEffect, useRef } from 'react';

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PromptComposer({ value, onChange, onSubmit, placeholder, disabled }: PromptComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit content, reset to 1 row when empty.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      disabled={disabled}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder={placeholder}
      style={{
        flex: 1,
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
        overflow: 'hidden',
        maxHeight: 200,
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
  );
}
