import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { PromptComposer } from './PromptComposer';

function renderComposer(overrides: Partial<Parameters<typeof PromptComposer>[0]> = {}) {
  const props = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    placeholder: 'Ask Claude...',
    ...overrides,
  };

  const view = render(<PromptComposer {...props} />);
  const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;

  return { ...view, props, textbox };
}

describe('PromptComposer', () => {
  it('submits on Enter', () => {
    const { props, textbox } = renderComposer({ value: 'run this' });

    fireEvent.keyDown(textbox, { key: 'Enter' });

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not submit on Shift+Enter', () => {
    const { props, textbox } = renderComposer({ value: 'line one' });

    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit while IME composition is active', () => {
    const { props, textbox } = renderComposer({ value: 'こんにちは' });
    const event = createEvent.keyDown(textbox, { key: 'Enter' });
    Object.defineProperty(event, 'isComposing', { value: true });

    fireEvent(textbox, event);

    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('calls onChange with textarea content', () => {
    const { props, textbox } = renderComposer();

    fireEvent.change(textbox, { target: { value: 'first line\nsecond line' } });

    expect(props.onChange).toHaveBeenCalledWith('first line\nsecond line');
  });

  it('shows a character counter only after 400 characters', () => {
    const { rerender } = renderComposer({ value: 'a'.repeat(400) });

    expect(screen.queryByText('400 chars')).toBeNull();

    rerender(
      <PromptComposer
        value={'a'.repeat(401)}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        placeholder="Ask Claude..."
      />
    );

    expect(screen.getByText('401 chars')).toBeDefined();
  });

  it('caps autogrow at 12 rows and enables internal scrolling', () => {
    const scrollHeight = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get');
    scrollHeight.mockReturnValue(500);

    const { textbox } = renderComposer({ value: Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') });

    expect(textbox.style.overflowY).toBe('auto');
    expect(Number.parseFloat(textbox.style.height)).toBeLessThan(500);

    scrollHeight.mockRestore();
  });
});
