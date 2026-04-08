// Quick Commands — saved command snippets stored in localStorage (TERMINAL-047)

export interface QuickCommand {
  id: string;
  name: string;
  command: string;
  createdAt: string;
}

const STORAGE_KEY = 'terminal:quick-commands';
const MAX_COMMANDS = 50;

export function getQuickCommands(): QuickCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QuickCommand[];
  } catch {
    return [];
  }
}

function persistQuickCommands(list: QuickCommand[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function saveQuickCommand(name: string, command: string): QuickCommand {
  const list = getQuickCommands();
  const entry: QuickCommand = {
    id: crypto.randomUUID(),
    name: name.trim(),
    command: command.trim(),
    createdAt: new Date().toISOString(),
  };
  const updated = [...list, entry];
  // If over limit, drop the oldest entries
  if (updated.length > MAX_COMMANDS) {
    updated.splice(0, updated.length - MAX_COMMANDS);
  }
  persistQuickCommands(updated);
  return entry;
}

export function deleteQuickCommand(id: string): void {
  const list = getQuickCommands().filter((c) => c.id !== id);
  persistQuickCommands(list);
}
