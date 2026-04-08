// Theme definitions — each theme overrides the CSS custom properties from tokens.css

export interface Theme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

export const themes: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight (default)',
    colors: {
      '--bg-base': '#0f1119',
      '--bg-surface': '#161822',
      '--bg-raised': '#1c1f2e',
      '--bg-overlay': '#232738',
      '--border-default': '#2a2d3d',
      '--border-focus': '#4ecdc4',
      '--text-primary': '#e2e4e9',
      '--text-secondary': '#8b8fa3',
      '--text-muted': '#555a6e',
      '--accent-primary': '#4ecdc4',
      '--accent-warn': '#e5a33d',
      '--accent-error': '#e55a5a',
      '--accent-info': '#7c8cf5',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    colors: {
      '--bg-base': '#1e1e2e',
      '--bg-surface': '#181825',
      '--bg-raised': '#313244',
      '--bg-overlay': '#45475a',
      '--border-default': '#585b70',
      '--border-focus': '#89b4fa',
      '--text-primary': '#cdd6f4',
      '--text-secondary': '#a6adc8',
      '--text-muted': '#6c7086',
      '--accent-primary': '#89b4fa',
      '--accent-warn': '#f9e2af',
      '--accent-error': '#f38ba8',
      '--accent-info': '#cba6f7',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      '--bg-base': '#282a36',
      '--bg-surface': '#21222c',
      '--bg-raised': '#343746',
      '--bg-overlay': '#44475a',
      '--border-default': '#6272a4',
      '--border-focus': '#bd93f9',
      '--text-primary': '#f8f8f2',
      '--text-secondary': '#bfbfbf',
      '--text-muted': '#6272a4',
      '--accent-primary': '#bd93f9',
      '--accent-warn': '#f1fa8c',
      '--accent-error': '#ff5555',
      '--accent-info': '#8be9fd',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    colors: {
      '--bg-base': '#1a1b26',
      '--bg-surface': '#16161e',
      '--bg-raised': '#24283b',
      '--bg-overlay': '#292e42',
      '--border-default': '#3b4261',
      '--border-focus': '#7aa2f7',
      '--text-primary': '#c0caf5',
      '--text-secondary': '#9aa5ce',
      '--text-muted': '#565f89',
      '--accent-primary': '#7aa2f7',
      '--accent-warn': '#e0af68',
      '--accent-error': '#f7768e',
      '--accent-info': '#bb9af7',
    },
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    colors: {
      '--bg-base': '#0d1117',
      '--bg-surface': '#161b22',
      '--bg-raised': '#21262d',
      '--bg-overlay': '#30363d',
      '--border-default': '#30363d',
      '--border-focus': '#58a6ff',
      '--text-primary': '#e6edf3',
      '--text-secondary': '#8b949e',
      '--text-muted': '#484f58',
      '--accent-primary': '#58a6ff',
      '--accent-warn': '#d29922',
      '--accent-error': '#f85149',
      '--accent-info': '#bc8cff',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: {
      '--bg-base': '#2e3440',
      '--bg-surface': '#3b4252',
      '--bg-raised': '#434c5e',
      '--bg-overlay': '#4c566a',
      '--border-default': '#4c566a',
      '--border-focus': '#88c0d0',
      '--text-primary': '#eceff4',
      '--text-secondary': '#d8dee9',
      '--text-muted': '#616e88',
      '--accent-primary': '#88c0d0',
      '--accent-warn': '#ebcb8b',
      '--accent-error': '#bf616a',
      '--accent-info': '#b48ead',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    colors: {
      '--bg-base': '#002b36',
      '--bg-surface': '#073642',
      '--bg-raised': '#0a4050',
      '--bg-overlay': '#124d5c',
      '--border-default': '#2aa198',
      '--border-focus': '#268bd2',
      '--text-primary': '#eee8d5',
      '--text-secondary': '#93a1a1',
      '--text-muted': '#586e75',
      '--accent-primary': '#268bd2',
      '--accent-warn': '#b58900',
      '--accent-error': '#dc322f',
      '--accent-info': '#6c71c4',
    },
  },
  // --- Light themes ---
  {
    id: 'github-light',
    name: 'GitHub Light',
    colors: {
      '--bg-base': '#ffffff',
      '--bg-surface': '#f6f8fa',
      '--bg-raised': '#eaeef2',
      '--bg-overlay': '#d0d7de',
      '--border-default': '#d0d7de',
      '--border-focus': '#0969da',
      '--text-primary': '#1f2328',
      '--text-secondary': '#656d76',
      '--text-muted': '#8c959f',
      '--accent-primary': '#0969da',
      '--accent-warn': '#9a6700',
      '--accent-error': '#cf222e',
      '--accent-info': '#8250df',
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    colors: {
      '--bg-base': '#eff1f5',
      '--bg-surface': '#e6e9ef',
      '--bg-raised': '#dce0e8',
      '--bg-overlay': '#ccd0da',
      '--border-default': '#bcc0cc',
      '--border-focus': '#1e66f5',
      '--text-primary': '#4c4f69',
      '--text-secondary': '#6c6f85',
      '--text-muted': '#9ca0b0',
      '--accent-primary': '#1e66f5',
      '--accent-warn': '#df8e1d',
      '--accent-error': '#d20f39',
      '--accent-info': '#8839ef',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    colors: {
      '--bg-base': '#fdf6e3',
      '--bg-surface': '#eee8d5',
      '--bg-raised': '#e6dfca',
      '--bg-overlay': '#ded7c2',
      '--border-default': '#93a1a1',
      '--border-focus': '#268bd2',
      '--text-primary': '#073642',
      '--text-secondary': '#586e75',
      '--text-muted': '#93a1a1',
      '--accent-primary': '#268bd2',
      '--accent-warn': '#b58900',
      '--accent-error': '#dc322f',
      '--accent-info': '#6c71c4',
    },
  },
];

const THEME_KEY = 'terminal:theme';

export function applyTheme(themeId: string): void {
  const theme = themes.find(t => t.id === themeId);
  if (!theme) return;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.colors)) {
    root.style.setProperty(prop, value);
  }
  localStorage.setItem(THEME_KEY, themeId);
}

export function loadSavedTheme(): string {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved && themes.some(t => t.id === saved)) {
    applyTheme(saved);
    return saved;
  }
  return 'midnight';
}

export function getCurrentThemeId(): string {
  return localStorage.getItem(THEME_KEY) ?? 'midnight';
}
