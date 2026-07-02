import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './styles/index.css';
import { App } from './ui/App';

// U-013 — register the service worker so the app is installable and boots offline
// after first load. `autoUpdate` (vite.config) silently swaps in new builds.
registerSW({ immediate: true });

const container = document.getElementById('root');
if (!container) {
  throw new Error('PixelForge: #root mount point not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
