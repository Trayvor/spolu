import { useEffect, type RefObject } from 'react';

const TABBABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/**
 * Keeps Tab inside `ref` while `active` (a modal sheet or panel): Tab at the last control goes to
 * the first and Shift+Tab the other way; focus that is outside is pulled in. With `restore` the
 * focus goes back to where it was when the trap closed. Escape stays with the caller.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, restore = true) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const origin = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => !el.hidden);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const current = document.activeElement;
      if (!root.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (restore && origin?.isConnected) origin.focus();
    };
  }, [ref, active, restore]);
}
