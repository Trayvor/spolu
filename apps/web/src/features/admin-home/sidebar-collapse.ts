import { useSyncExternalStore } from 'react';

/** Whether the admin client sidebar is collapsed to its rail, remembered per device. */
const KEY = 'spolu.sidebar.collapsed';

const listeners = new Set<() => void>();
// The choice for this page load, used when storage is blocked and shared by the sidebar and the
// frame around the page (which widens the page when the rail is collapsed).
let current = false;

export function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return current; // storage blocked: expanded until the sidebar is toggled
  }
}

export function writeCollapsed(collapsed: boolean): void {
  current = collapsed;
  try {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The collapsed state, live: every component using it follows the sidebar's toggle. */
export function useCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readCollapsed, () => false);
}
