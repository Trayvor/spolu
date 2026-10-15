import { useEffect } from 'react';

/**
 * Stops the page behind a sheet from scrolling while `active` (and, with `query`, while that media
 * query matches; it follows changes, e.g. a rotated tablet). Gives the page back on release.
 * Shared by the task panel and the action sheet.
 */
export function useScrollLock(active: boolean, query?: string): void {
  useEffect(() => {
    if (!active) return;
    const media =
      query && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    if (query && !media) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    const apply = () => {
      root.style.overflow = !media || media.matches ? 'hidden' : before;
    };
    apply();
    media?.addEventListener('change', apply);
    return () => {
      media?.removeEventListener('change', apply);
      root.style.overflow = before;
    };
  }, [active, query]);
}
