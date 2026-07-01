import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import { App } from './ui/App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('PixelForge: #root mount point not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
