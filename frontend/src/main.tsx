import './styles/tokens.css';
import { loadSavedTheme } from './styles/themes';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.tsx'

// Apply saved theme before first render
loadSavedTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
