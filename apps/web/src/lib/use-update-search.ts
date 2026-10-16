import { useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';

export type SearchRecord = Record<string, unknown>;

/**
 * Changes the current route's search params in place (`to: '.'`), for routes that declare no
 * search schema: `change` edits a copy of the params, every other param is kept.
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
          return next;
        }) as never,
      }),
    [navigate],
  );
}
