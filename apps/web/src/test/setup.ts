import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { configure } from '@testing-library/react';
import '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';

configure({ asyncUtilTimeout: 4000 });
// jsdom does not implement scrollTo; the router calls it on navigation.
window.scrollTo = () => undefined;
// Component tests render parts of screens without their routes: give them every lazy locale
// namespace up front. src/router-i18n.test.tsx resets them to test the real loading per route.
await loadAllNamespaces();

// Remembered list filters (`lib/use-remembered-filters.ts`) must not carry over between tests:
// one test's filters would come back in the next test's list.
beforeEach(() => {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('spolu.filters.')) localStorage.removeItem(key);
    }
  } catch {
    // A test that blocks storage restores it itself.
  }
});
