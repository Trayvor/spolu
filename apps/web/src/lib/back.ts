import type { AnyRouter } from '@tanstack/react-router';

/** The history entry's position, kept in its state by `@tanstack/history`. */
const INDEX = '__TSR_index';

/** The path and search of every history entry this tab has shown, by position. */
const seen = new Map<number, string>();

const indexOf = (state: unknown): number | undefined => {
  const index = (state as Record<string, unknown> | undefined)?.[INDEX];
  return typeof index === 'number' ? index : undefined;
};

/** Records each entry the router shows (once, in `createAppRouter`). */
export function trackHistory(router: AnyRouter): () => void {
  const record = () => {
    const location = router.state.location;
    const index = indexOf(location.state);
    if (index !== undefined) seen.set(index, location.href);
  };
  record();
  return router.subscribe('onResolved', record);
}

/** Tests only: forget the recorded entries. */
export function resetHistoryTracking() {
  seen.clear();
}

/**
 * The entry before the current one, when this tab showed it (it is part of the app, not a page
 * of another site or an entry from before a reload).
 */
export function previousHref(router: AnyRouter): string | undefined {
  const index = indexOf(router.state.location.state);
  return index === undefined || index === 0 ? undefined : seen.get(index - 1);
}

/**
 * "Close", "Back" and "Done" of something that was opened (a task, an item, a thread, a sheet):
 * one step back when the entry before is the app's own and `accept` agrees (by default any
 * in-app entry: where the person came from), else `fallback` (usually a replace to the parent
 * screen). So closing never adds an entry that Back would then reopen.
 */
export function backOr(
  router: AnyRouter,
  fallback: () => void,
  accept: (href: string) => boolean = () => true,
): void {
  const previous = previousHref(router);
  if (previous !== undefined && accept(previous)) router.history.back();
  else fallback();
}

/**
 * `backOr`'s `accept` for something open on the current screen (a thread, an item): the entry
 * before is this same path and has none of `params` (it is the screen without it).
 */
export function samePath(router: AnyRouter, params: string[] = []) {
  const here = router.state.location.pathname;
  return (href: string) => {
    const url = new URL(href, 'http://app.invalid');
    return url.pathname === here && params.every((p) => !url.searchParams.has(p));
  };
}
