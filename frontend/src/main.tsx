import '@fontsource-variable/inter/index.css';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/animations.css';
import './styles/mobile.css';
import { loadSavedScheme } from './styles/appearance';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'

// Apply the saved scheme (light/dark theme + accent) before first render
loadSavedScheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)