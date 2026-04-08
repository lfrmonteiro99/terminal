// Central shortcut map — stores default and user-customized keybindings
// All command palette entries reference this map for their displayed shortcut.

const STORAGE_KEY = 'terminal:shortcuts';

const DEFAULTS: Record<string, string> = {
  'pane:split-right': 'Ctrl+Shift+|',
  'pane:split-down': 'Ctrl+Shift+_',
  'layout:terminal': 'Ctrl+Alt+1',
  'layout:ai': 'Ctrl+Alt+2',
  'layout:git': 'Ctrl+Alt+3',
  'layout:browser': 'Ctrl+Alt+4',
  'sidebar:toggle': 'Ctrl+B',
  'sidebar:explorer': 'Ctrl+Shift+E',
  'sidebar:changes': 'Ctrl+Shift+G',
  'sidebar:git': 'Ctrl+Shift+H',
  'git:refresh': 'Ctrl+Shift+R',
  'git:push': '',
  'git:pull': '',
  'git:fetch': '',
  'workspace:list': '',
};

let userOverrides: Record<string, string> = {};

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveOverrides(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userOverrides));
}

// Initialize on import
userOverrides = loadOverrides();

export function getShortcut(commandId: string): string {
  return userOverrides[commandId] ?? DEFAULTS[commandId] ?? '';
}

export function setShortcut(commandId: string, shortcut: string): void {
  userOverrides[commandId] = shortcut;
  saveOverrides();
}

export function resetShortcuts(): void {
  userOverrides = {};
  localStorage.removeItem(STORAGE_KEY);
}

export function getAllShortcuts(): { id: string; shortcut: string; isCustom: boolean }[] {
  const allIds = new Set([...Object.keys(DEFAULTS), ...Object.keys(userOverrides)]);
  return Array.from(allIds).map(id => ({
    id,
    shortcut: getShortcut(id),
    isCustom: id in userOverrides,
  }));
}
