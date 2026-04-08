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

let _paneCounter = 0;

/** Split a pane by ID, inserting a new pane of the given kind in the given direction. */
export function splitPane(
  layout: PaneLayout,
  targetPaneId: string,
  direction: SplitDirection,
  kind: PaneKind = 'Terminal',
): { layout: PaneLayout; newPaneId: string } | null {
  if (isSingle(layout)) {
    if (layout.Single.id === targetPaneId) {
      const newPaneId = `${kind.toLowerCase()}-${++_paneCounter}-${Date.now()}`;
      return {
        layout: {
          Split: {
            direction,
            ratio: 0.5,
            first: layout,
            second: { Single: { id: newPaneId, kind, resource_id: null } },
          },
        },
        newPaneId,
      };
    }
    return null;
  }

  if (isSplit(layout)) {
    const firstResult = splitPane(layout.Split.first, targetPaneId, direction);
    if (firstResult) {
      return {
        layout: {
          Split: { ...layout.Split, first: firstResult.layout },
        },
        newPaneId: firstResult.newPaneId,
      };
    }
    const secondResult = splitPane(layout.Split.second, targetPaneId, direction);
    if (secondResult) {
      return {
        layout: {
          Split: { ...layout.Split, second: secondResult.layout },
        },
        newPaneId: secondResult.newPaneId,
      };
    }
  }

  return null;
}

/** Close a pane by ID. Returns the remaining layout, or null if it was the last pane. */
export function closePane(layout: PaneLayout, targetPaneId: string): PaneLayout | null {
  if (isSingle(layout)) {
    return layout.Single.id === targetPaneId ? null : layout;
  }

  if (isSplit(layout)) {
    const { first, second, ...rest } = layout.Split;

    // Check if target is directly in first or second
    if (isSingle(first) && first.Single.id === targetPaneId) return second;
    if (isSingle(second) && second.Single.id === targetPaneId) return first;

    // Recurse into children
    const newFirst = closePane(first, targetPaneId);
    if (newFirst !== first) {
      return newFirst ? { Split: { ...rest, first: newFirst, second } } : second;
    }
    const newSecond = closePane(second, targetPaneId);
    if (newSecond !== second) {
      return newSecond ? { Split: { ...rest, first, second: newSecond } } : first;
    }
  }

  return layout;
}
