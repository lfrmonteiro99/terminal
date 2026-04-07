// Built-in mode definitions (M3-01, M4-03, M5-02)

import { registerMode } from './registry';

registerMode({
  id: 'AiSession',
  label: 'AI Session',
  icon: '🤖',
  description: 'AI-assisted coding with Claude',
  defaultLayout: () => ({ Single: { id: 'ai-run', kind: 'AiRun', resource_id: null } }),
  shortcut: 'Ctrl+1',
});

registerMode({
  id: 'Terminal',
  label: 'Terminal',
  icon: '>_',
  description: 'Multi-pane terminal',
  defaultLayout: () => ({ Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } }),
  shortcut: 'Ctrl+2',
});

registerMode({
  id: 'Git',
  label: 'Git',
  icon: '⎇',
  description: 'Repository status, history, and conflict resolution',
  defaultLayout: () => ({
    Split: {
      direction: 'Horizontal' as const,
      ratio: 0.4,
      first: { Single: { id: 'git-status', kind: 'GitStatus' as const, resource_id: null } },
      second: { Single: { id: 'git-history', kind: 'GitHistory' as const, resource_id: null } },
    },
  }),
  shortcut: 'Ctrl+3',
});

registerMode({
  id: 'Browser',
  label: 'Browser',
  icon: '◎',
  description: 'Embedded browser pane',
  defaultLayout: () => ({ Single: { id: 'browser-0', kind: 'Browser' as const, resource_id: null } }),
  shortcut: 'Ctrl+4',
});
