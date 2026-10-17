import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FinanceEvents } from '@spolu/shared';
import { sessionQuery } from '@/features/auth/use-session';
import { getSocket } from '@/lib/socket';

/**
 * `me:changed` (Phase 32): the superadmin granted or removed the signed-in admin's finance right.
 * Refetches `/api/me`, so the Financie tab and header link appear or vanish without a reload, and
 * drops cached finance data when the right went. Mounted once in the authed layout.
 */
export function useMeChanged(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const socket = getSocket();
    const onChanged = async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
      if (!queryClient.getQueryData<{ finance: boolean } | null>(sessionQuery.queryKey)?.finance) {
        queryClient.removeQueries({ queryKey: ['finance'] });
      }
    };
    socket.on(FinanceEvents.meChanged, onChanged);
    return () => {
      socket.off(FinanceEvents.meChanged, onChanged);
    };
  }, [queryClient]);
}
