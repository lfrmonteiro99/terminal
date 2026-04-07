// Workspace domain types — mirrors terminal-core/src/models.rs (M1-01)

import type { PaneLayout } from '../pane/types';

export type WorkspaceMode = 'AiSession' | 'Terminal' | 'Git' | 'Browser';

export interface WorkspaceSummary {
  id: string;
  name: string;
  root_path: string;
  mode: WorkspaceMode;
  linked_session_id: string | null;
  last_active_at: string;
}

export interface Workspace extends WorkspaceSummary {
  layout: PaneLayout;
  created_at: string;
}

// Re-export pane layout types for convenience
export type { PaneLayout, PaneDefinition, PaneKind, SplitDirection } from '../pane/types';
