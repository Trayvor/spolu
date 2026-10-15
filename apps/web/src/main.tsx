import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import '@/i18n';
import { queryClient } from '@/lib/query-client';
import { router } from '@/router';
import '@/styles/index.css';

// After a deploy the old hashed chunks are gone; a tab opened before it reloads to get the new build.
window.addEventListener('vite:preloadError', () => window.location.reload());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
