// Pane smoke test — rendering EmptyPane must not throw. Pane components that
// depend on AppContext are exercised separately; EmptyPane is context-free,
// so this is a pure render check.

import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { EmptyPane } from './EmptyPane';

afterEach(cleanup);

describe('EmptyPane', () => {
  it('renders the "choose a pane type" prompt', () => {
    render(
      <EmptyPane
        pane={{ id: 'p1', kind: 'Empty', resource_id: null }}
        workspaceId="w1"
        focused={true}
      />,
    );
    expect(screen.getByText(/choose a pane type/i)).toBeTruthy();
  });

  it('renders a button per pane option', () => {
    render(
      <EmptyPane
        pane={{ id: 'p1', kind: 'Empty', resource_id: null }}
        workspaceId="w1"
        focused={false}
      />,
    );
    // Terminal, SSH, AI Run, Browser, Git Status, Git History
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });
});
