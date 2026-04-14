import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

function BrokenComponent(): ReactElement {
  throw new Error('Test crash');
}

function WorkingComponent(): ReactElement {
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <WorkingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('All good')).toBeDefined();
  });

  it('renders fallback UI on child error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
    expect(screen.getByText(/reload/i)).toBeDefined();
    spy.mockRestore();
  });

  it('shows the error message in fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText(/test crash/i)).toBeDefined();
    spy.mockRestore();
  });
});
