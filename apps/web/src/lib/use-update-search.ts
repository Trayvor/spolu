import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

export type SearchRecord = Record<string, unknown>;

/**
 * Changes the current route's search params in place (`to: '.'`), for routes that declare no
 * search schema: `change` edits a copy of the params, every other param is kept.
 *
 * A param `change` deletes is sent as an explicit `undefined`: a route with
 * `retainSearchParams` (the group board keeps its filters across the task panel routes) copies
 * back every retained key that is merely missing, so a plain `delete` would never clear it.
 * The router drops `undefined` from the URL.
 */
export function useUpdateSearch() {
  const navigate = useNavigate();
  return useCallback(
    (change: (next: SearchRecord) => void, { replace }: { replace: boolean }) =>
      void navigate({
        to: '.',
        replace,
        search: ((prev: SearchRecord) => {
          const next = { ...prev };
          change(next);
          for (const key of Object.keys(prev)) if (!(key in next)) next[key] = undefined;
          return next;
        }) as never,
      }),
    [navigate],
  );
}
