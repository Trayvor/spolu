import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';

configure({ asyncUtilTimeout: 4000 });
// jsdom does not implement scrollTo; the router calls it on navigation.
window.scrollTo = () => undefined;
// jsdom never has focus; a tested page is the one the reader is in front of, as in a browser.
document.hasFocus = () => true;
// Component tests render parts of screens without their routes: give them every lazy locale
// namespace up front. src/router-i18n.test.tsx resets them to test the real loading per route.
await loadAllNamespaces();
