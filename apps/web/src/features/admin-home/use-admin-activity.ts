import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { AdminEvents, ChatEvents, type AdminActivityEvent } from '@spolu/shared';
import { useDocumentVisible } from '@/features/chat/use-document-visible';
import { getSocket } from '@/lib/socket';

export const ADMIN_ACTIVITY_DEBOUNCE_MS = 2000;

/**
 * Refetches `keys` after activity anywhere: `admin:activity` (a chat or task write in any group,
 * admins room) and `chat:read` (the viewer read something here or on another device, which clears
 * counts). Bursts are coalesced: each event starts or extends a 2 s timer. When it fires on a
 * hidden page the keys are only marked stale, and refetched once the page is visible again.
 */
export function useAdminActivityRefetch(
  keys: readonly QueryKey[],
  /** Only these kinds of activity count; `chatRead: false` ignores `chat:read` (the board). */
  {
    kinds = ['chat', 'task'],
    chatRead = true,
  }: {
    kinds?: AdminActivityEvent['kind'][];
    chatRead?: boolean;
  } = {},
): void {
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();
  const visibleRef = useRef(visible);
  const pending = useRef(false);
  // A value, not the array's identity: callers may pass a new array on every render.
  const keysJson = JSON.stringify(keys);
  const kindsKey = kinds.join(',');

  useEffect(() => {
    const parsed = JSON.parse(keysJson) as QueryKey[];
    visibleRef.current = visible;
    if (visible && pending.current) {
      pending.current = false;
      for (const queryKey of parsed) void queryClient.invalidateQueries({ queryKey });
    }
  }, [visible, keysJson, queryClient]);

  useEffect(() => {
    const parsed = JSON.parse(keysJson) as QueryKey[];
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      const now = visibleRef.current;
      if (!now) pending.current = true;
      for (const queryKey of parsed) {
        void queryClient.invalidateQueries(now ? { queryKey } : { queryKey, refetchType: 'none' });
      }
    };
    const wanted = new Set(kindsKey.split(','));
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(fire, ADMIN_ACTIVITY_DEBOUNCE_MS);
    };
    const onActivity = (event: AdminActivityEvent) => {
      if (wanted.has(event.kind)) schedule();
    };
    socket.on(AdminEvents.activity, onActivity);
    if (chatRead) socket.on(ChatEvents.read, schedule);
    return () => {
      clearTimeout(timer);
      socket.off(AdminEvents.activity, onActivity);
      socket.off(ChatEvents.read, schedule);
    };
  }, [keysJson, kindsKey, chatRead, queryClient]);
}
