import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BulkEvents, type BulkEventPayload } from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { firstJoinCheck } from '@/lib/socket-history';
import { campaignListKey, campaignQuery } from './api';

/**
 * Keeps the campaign list and an open campaign fresh: `bulk:updated { campaignId }` (admins
 * room) refetches the list and that campaign. A send emits after every batch, so the refetch
 * waits 2 s after the last event and covers every campaign named meanwhile. After a reconnect everything refetches, since
 * events sent while the socket was down are lost; the first `connect` after the mount refetches
 * only what `firstJoinCheck` says may have missed events, not the list the mount just loaded.
 */
export const BULK_EVENTS_DEBOUNCE_MS = 2000;

export function useBulkEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdated = (payload: BulkEventPayload) => {
      pending.add(payload.campaignId);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ids = [...pending];
        pending.clear();
        void queryClient.invalidateQueries({ queryKey: campaignListKey });
        for (const id of ids) {
          void queryClient.invalidateQueries({ queryKey: campaignQuery(id).queryKey });
        }
      }, BULK_EVENTS_DEBOUNCE_MS);
    };
    let firstConnect: ReturnType<typeof firstJoinCheck> | null = firstJoinCheck(socket);
    const onConnect = () => {
      const stale = firstConnect;
      firstConnect = null;
      void queryClient.invalidateQueries({
        queryKey: campaignListKey,
        predicate: stale ? (query) => stale(query.state) : undefined,
      });
    };
    socket.on(BulkEvents.updated, onUpdated);
    socket.on('connect', onConnect);
    return () => {
      clearTimeout(timer);
      socket.off(BulkEvents.updated, onUpdated);
      socket.off('connect', onConnect);
    };
  }, [queryClient]);
}
