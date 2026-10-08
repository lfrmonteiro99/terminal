import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBanner } from './ErrorBanner';

// Daemon-level `Error` events used to set `state.error` and render nowhere, so
// a rejected run and a busy directory were both invisible. This is the surface
// that makes them visible; if it regresses, every such error silently returns.

describe('ErrorBanner', () => {
  it('shows the code and the message, including the path that was wrong', () => {
    render(
      <ErrorBanner
        message="PROJECT_ROOT_MISSING: Project directory does not exist: /home/x/gone"
        onDismiss={() => {}}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('PROJECT_ROOT_MISSING');
    expect(alert.textContent).toContain('/home/x/gone');
  });

  it('dismisses on click', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="boom" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss error'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
