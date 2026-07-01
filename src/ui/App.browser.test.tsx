import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { App } from './App';

// Runs in a real Chromium via Vitest Browser Mode (`npm run test:browser`).
// Kept out of the default `npm test` run so unit tests need no browser download.
test('App shell renders the PixelForge wordmark in a real browser', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  await vi.waitFor(() => {
    const heading = host.querySelector('h1');
    expect(heading?.textContent).toContain('PixelForge');
  });

  root.unmount();
  host.remove();
});
