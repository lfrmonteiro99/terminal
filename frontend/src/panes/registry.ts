// Pane registry — maps PaneKind to React component (M2-01)

import type { ComponentType } from 'react';
import type { PaneKind } from '../domain/pane/types';
import type { PaneDefinition } from '../domain/pane/types';

export interface PaneProps {
  pane: PaneDefinition;
  workspaceId: string;
  focused: boolean;
}

type PaneComponent = ComponentType<PaneProps>;

const registry = new Map<PaneKind, PaneComponent>();

export function registerPane(kind: PaneKind, component: PaneComponent): void {
  registry.set(kind, component);
}

export function getPane(kind: PaneKind): PaneComponent | null {
  return registry.get(kind) ?? null;
}

export function listRegisteredKinds(): PaneKind[] {
  return Array.from(registry.keys());
}
