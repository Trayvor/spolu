/** Whether the admin client sidebar is collapsed to its rail, remembered per device. */
const KEY = 'spolu.sidebar.collapsed';

export function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage blocked: expanded
  }
}

export function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts until the page is reloaded
  }
}
