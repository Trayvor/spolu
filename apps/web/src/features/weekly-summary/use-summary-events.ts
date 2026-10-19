import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WeeklySummaryEvents, type WeeklySummaryChanged } from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { firstJoinCheck } from '@/lib/socket-history';
import { summaryKeys } from './api';

export const SUMMARY_EVENTS_DEBOUNCE_MS = 2000;

/**
 * Keeps the list, the archive and an open summary fresh: `weekly-summary:changed` (admins room)
 * refetches them 2 s after the last event; after a reconnect everything refetches (the first
 * connect only what `firstJoinCheck` says may have missed events). `onChanged` sees every event
 * at once (the editor compares versions).
 */
export function useSummaryEvents(onChanged?: (event: WeeklySummaryChanged) => void): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onEvent = (payload: WeeklySummaryChanged) => {
      onChanged?.(payload);
      pending.add(payload.id);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ids = [...pending];
        pending.clear();
        void queryClient.invalidateQueries({ queryKey: [...summaryKeys.all, 'list'] });
        void queryClient.invalidateQueries({ queryKey: [...summaryKeys.all, 'archive'] });
        for (const id of ids) {
          void queryClient.invalidateQueries({ queryKey: summaryKeys.detail(id) });
          void queryClient.invalidateQueries({ queryKey: summaryKeys.revisions(id) });
        }
      }, SUMMARY_EVENTS_DEBOUNCE_MS);
    };
    let firstConnect: ReturnType<typeof firstJoinCheck> | null = firstJoinCheck(socket);
    const onConnect = () => {
      const stale = firstConnect;
      firstConnect = null;
      void queryClient.invalidateQueries({
        queryKey: summaryKeys.all,
        predicate: stale ? (query) => stale(query.state) : undefined,
      });
    };
    socket.on(WeeklySummaryEvents.changed, onEvent);
    socket.on('connect', onConnect);
    return () => {
      clearTimeout(timer);
      socket.off(WeeklySummaryEvents.changed, onEvent);
      socket.off('connect', onConnect);
    };
  }, [queryClient, onChanged]);
}
