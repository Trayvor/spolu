import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FinanceEvents, type FinanceChangedEvent } from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { financeViewKey, type FinanceView } from './api';

export const FINANCE_REFETCH_DEBOUNCE_MS = 2000;

/**
 * Keeps an open finance screen live (Phase 32): `finance:changed` (the `finance` room, finance
 * admins only) refetches the view's queries, 2 s after the last event of a burst. A client's tab
 * listens to its own client and to changes of no client (rates); the system-wide page to all.
 */
export function useFinanceEvents(view: FinanceView): void {
  const queryClient = useQueryClient();
  const groupId = view.kind === 'group' ? view.groupId : null;
  const key = JSON.stringify(financeViewKey(view));

  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = (event: FinanceChangedEvent) => {
      if (groupId !== null && event.groupId !== null && event.groupId !== groupId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
      }, FINANCE_REFETCH_DEBOUNCE_MS);
    };
    socket.on(FinanceEvents.changed, onChanged);
    return () => {
      clearTimeout(timer);
      socket.off(FinanceEvents.changed, onChanged);
    };
  }, [groupId, key, queryClient]);
}
