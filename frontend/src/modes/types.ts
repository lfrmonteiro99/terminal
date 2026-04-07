// ModeDefinition system (M3-01)

import type { WorkspaceMode } from '../domain/workspace/types';
import type { PaneLayout } from '../domain/pane/types';

export interface ModeDefinition {
  id: WorkspaceMode;
  label: string;
  icon: string;
  description: string;
  defaultLayout: () => PaneLayout;
  /** Keyboard shortcut to switch to this mode */
  shortcut?: string;
}
