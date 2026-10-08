import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WelcomeScreen } from './WelcomeScreen';
import type { SessionSummary } from '../types/protocol';

/** The daemon keeps one session per StartSession call, so a project worked on
 *  daily accumulates dozens of entries. */
function daemonSession(i: number): SessionSummary {
  return {
    id: `session-${i}`,
    project_root: `/tmp/project-${i}`,
    active_run: null,
    run_count: i,
    started_at: new Date(Date.now() - i * 60_000).toISOString(),
  };
}

function renderWith(sessions: SessionSummary[]) {
  return render(
    <WelcomeScreen
      onOpenSession={() => {}}
      onNewSession={() => {}}
      daemonSessions={sessions}
    />,
  );
}

describe('WelcomeScreen', () => {
  it('keeps the New Session form reachable when the session list is long', () => {
    // A full daemon history: the card must stay bounded and the lists scroll,
    // otherwise the card grows past the viewport and the form — the only way to
    // start anything — is pushed off-screen with no way to scroll to it.
    renderWith(Array.from({ length: 60 }, (_, i) => daemonSession(i)));

    expect(screen.getByPlaceholderText('/path/to/project')).toBeDefined();
    expect(screen.getByText('New Session')).toBeDefined();
  });

  it('makes the session list a scroll container rather than a growing block', () => {
    renderWith(Array.from({ length: 60 }, (_, i) => daemonSession(i)));

    const label = screen.getByText('Recent');
    const section = label.parentElement as HTMLElement;
    const style = getComputedStyle(section);

    expect(style.overflowY).toBe('auto');
    // min-height:0 is what lets a flex child actually shrink; without it the
    // section refuses to go below its content height and the card overflows.
    expect(style.minHeight).toBe('0px');
  });

  it('caps the card so it can never grow past the viewport', () => {
    const { container } = renderWith(Array.from({ length: 60 }, (_, i) => daemonSession(i)));

    const card = container.querySelector('.welcome-card') as HTMLElement;
    expect(card).not.toBeNull();
    // jsdom's default for an unset max-height is `none` — assert a real bound
    // exists, not merely that the property is non-empty.
    const maxHeight = getComputedStyle(card).maxHeight;
    expect(maxHeight).not.toBe('none');
    expect(maxHeight).not.toBe('');
  });

  it('shows the empty state, not a bare list, when nothing has run yet', () => {
    renderWith([]);
    expect(screen.getByText(/no recent sessions/i)).toBeDefined();
  });
});
