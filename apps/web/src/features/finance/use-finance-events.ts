import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FinanceEvents, type FinanceChangedEvent } from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { financeViewKey, type FinanceView } from './api';

export const FINANCE_REFETCH_DEBOUNCE_MS = 2000;

/** The organisation's items (`ownerKey(ORG_OWNER, …)`). */
const ORG_ITEMS_KEY = ['finance', 'all', 'org'];

/**
 * Keeps an open finance screen live (Phase 32): `finance:changed` (the `finance` room, finance
 * admins only) refetches the view's queries, 2 s after the last event of a burst. A client's tab
 * listens to its own client and to changes of no client (rates); the system-wide page to all.
 * A change of no client also refetches the organisation's items in a tab (`ORG_OWNER`'s keys),
 * which the admin group's tab shows (Phase 34 part E); elsewhere no such query is active.
 */
export function useFinanceEvents(view: FinanceView): void {
  const queryClient = useQueryClient();
  const groupId = view.kind === 'group' ? view.groupId : null;
  const key = JSON.stringify(financeViewKey(view));

  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let org = false;
    const onChanged = (event: FinanceChangedEvent) => {
      if (groupId !== null && event.groupId !== null && event.groupId !== groupId) return;
      if (groupId !== null && event.groupId === null) org = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: JSON.parse(key) as unknown[] });
        if (org) void queryClient.invalidateQueries({ queryKey: ORG_ITEMS_KEY });
        org = false;
      }, FINANCE_REFETCH_DEBOUNCE_MS);
    };
    socket.on(FinanceEvents.changed, onChanged);
    return () => {
      clearTimeout(timer);
      socket.off(FinanceEvents.changed, onChanged);
    };
  }, [groupId, key, queryClient]);
}
