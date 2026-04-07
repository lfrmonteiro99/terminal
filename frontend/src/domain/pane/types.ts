// Pane domain types — mirrors terminal-core/src/models.rs (M1-01)

export type PaneKind =
  | 'AiRun'
  | 'Terminal'
  | 'GitStatus'
  | 'GitHistory'
  | 'FileExplorer'
  | 'Browser'
  | 'Diff';

export interface PaneDefinition {
  id: string;
  kind: PaneKind;
  resource_id: string | null;
}

export type SplitDirection = 'Horizontal' | 'Vertical';

export type PaneLayout =
  | { Single: PaneDefinition }
  | {
      Split: {
        direction: SplitDirection;
        ratio: number;
        first: PaneLayout;
        second: PaneLayout;
      };
    };

export function isSplit(layout: PaneLayout): layout is { Split: { direction: SplitDirection; ratio: number; first: PaneLayout; second: PaneLayout } } {
  return 'Split' in layout;
}

export function isSingle(layout: PaneLayout): layout is { Single: PaneDefinition } {
  return 'Single' in layout;
}

export function collectPanes(layout: PaneLayout): PaneDefinition[] {
  if (isSingle(layout)) return [layout.Single];
  return [...collectPanes(layout.Split.first), ...collectPanes(layout.Split.second)];
}
