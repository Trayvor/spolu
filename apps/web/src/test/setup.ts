import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { configure } from '@testing-library/react';
import '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';

// findBy*, waitFor and waitForElementToBeRemoved give up after this long. It only bounds a real
// hang: a screen that never renders still fails, just later. A tight value (the default is 1 s)
// fails healthy tests when the machine is loaded (many parallel runs, load average 30 or more).
configure({ asyncUtilTimeout: 5000 });
// jsdom does not implement scrollTo; the router calls it on navigation.
window.scrollTo = () => undefined;
// Component tests render parts of screens without their routes: give them every lazy locale
// namespace up front. src/router-i18n.test.tsx resets them to test the real loading per route.
await loadAllNamespaces();
// The chat composer's editor (ProseMirror) measures the layout, which jsdom has none of.
const noRects = () => [] as unknown as DOMRectList;
Range.prototype.getClientRects ??= noRects;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
document.elementFromPoint ??= () => null;

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
