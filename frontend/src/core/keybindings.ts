// Keybinding layer — app-level vs pane-level scoping (M4-05)

export type KeyBindingScope = 'app' | 'pane';

export interface KeyBinding {
  id: string;
  keys: string; // e.g., "Ctrl+P", "Ctrl+Shift+T"
  scope: KeyBindingScope;
  description: string;
  action: () => void;
}

const bindings = new Map<string, KeyBinding>();

export function registerBinding(binding: KeyBinding): void {
  bindings.set(binding.id, binding);
}

export function unregisterBinding(id: string): void {
  bindings.delete(id);
}

function matchesEvent(binding: KeyBinding, e: KeyboardEvent): boolean {
  const parts = binding.keys.split('+');
  const key = parts[parts.length - 1];
  const ctrl = parts.includes('Ctrl');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');

  return (
    e.key === key &&
    e.ctrlKey === ctrl &&
    e.shiftKey === shift &&
    e.altKey === alt
  );
}

/** Install the global key handler. Returns a cleanup function. */
export function installGlobalKeybindings(): () => void {
  const handler = (e: KeyboardEvent) => {
    // Skip if focus is inside a terminal pane (pane-scoped)
    const target = e.target as HTMLElement;
    const inTerminal = target.closest?.('[data-pane-kind="terminal"]') !== null;

    for (const binding of bindings.values()) {
      if (binding.scope === 'pane' && !inTerminal) continue;
      if (binding.scope === 'app' && inTerminal) continue;
      if (matchesEvent(binding, e)) {
        e.preventDefault();
        binding.action();
        return;
      }
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
