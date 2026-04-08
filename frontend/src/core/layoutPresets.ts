import type { PaneLayout } from '../domain/pane/types';

export const LAYOUT_PRESETS: Record<string, { label: string; layout: PaneLayout }> = {
  terminal: {
    label: 'Terminal Focus',
    layout: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
  },
  ai: {
    label: 'AI Session',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.5,
        first: { Single: { id: 'ai-run', kind: 'AiRun', resource_id: null } },
        second: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
      },
    },
  },
  git: {
    label: 'Git Review',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.4,
        first: { Single: { id: 'git-status', kind: 'GitStatus', resource_id: null } },
        second: { Single: { id: 'git-history', kind: 'GitHistory', resource_id: null } },
      },
    },
  },
  browser: {
    label: 'Browser + Terminal',
    layout: {
      Split: {
        direction: 'Horizontal', ratio: 0.5,
        first: { Single: { id: 'terminal-0', kind: 'Terminal', resource_id: null } },
        second: { Single: { id: 'browser-0', kind: 'Browser', resource_id: null } },
      },
    },
  },
};
