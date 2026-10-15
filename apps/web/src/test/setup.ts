import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 4000 });
// jsdom does not implement scrollTo; the router calls it on navigation.
window.scrollTo = () => undefined;
