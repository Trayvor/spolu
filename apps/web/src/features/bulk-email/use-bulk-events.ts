import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BulkEvents, type BulkEventPayload } from '@spolu/shared';
import { getSocket } from '@/lib/socket';
import { campaignListKey, campaignQuery } from './api';

/**
 * Keeps the campaign list and an open campaign fresh: `bulk:updated { campaignId }` (admins
 * room) refetches the list and that campaign. After a reconnect everything refetches, since
 * events sent while the socket was down are lost.
 */
export function useBulkEvents(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const onUpdated = (payload: BulkEventPayload) => {
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
      void queryClient.invalidateQueries({ queryKey: campaignQuery(payload.campaignId).queryKey });
    };
    const onConnect = () => {
      void queryClient.invalidateQueries({ queryKey: campaignListKey });
    };
    socket.on(BulkEvents.updated, onUpdated);
    socket.on('connect', onConnect);
    return () => {
      socket.off(BulkEvents.updated, onUpdated);
      socket.off('connect', onConnect);
    };
  }, [queryClient]);
}
