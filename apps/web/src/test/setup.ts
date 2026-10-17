import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import '@/i18n';
import { loadAllNamespaces } from '@/i18n/namespaces';

configure({ asyncUtilTimeout: 4000 });
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
