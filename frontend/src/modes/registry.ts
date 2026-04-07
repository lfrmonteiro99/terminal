// Mode registry — registers all available modes (M3-01)

import type { WorkspaceMode } from '../domain/workspace/types';
import type { ModeDefinition } from './types';

const modeRegistry = new Map<WorkspaceMode, ModeDefinition>();

export function registerMode(def: ModeDefinition): void {
  modeRegistry.set(def.id, def);
}

export function getMode(id: WorkspaceMode): ModeDefinition | null {
  return modeRegistry.get(id) ?? null;
}

export function listModes(): ModeDefinition[] {
  return Array.from(modeRegistry.values());
}
