import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AdminEvents,
  ChatEvents,
  SeenEvents,
  SIDEBAR_PATCH_MAX,
  SidebarSchema,
  TicketEvents,
  type AdminActivityEvent,
  type ChatReadEvent,
  type SeenChangedEvent,
  type SidebarClient,
  type TicketEventPayload,
} from '@spolu/shared';
import { useDocumentVisible } from '@/features/chat/use-document-visible';
import { apiGet } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { homeKeys } from './api';
import { ADMIN_ACTIVITY_DEBOUNCE_MS } from './use-admin-activity';

const badge = (c: SidebarClient) => c.unread + c.unseenTasks + c.unseenTickets > 0;

/** The server's sidebar order (`sidebarSql`): internal, managed, with a badge, then by name. */
function before(a: SidebarClient, b: SidebarClient): boolean {
  const keys = (c: SidebarClient) => [c.section === 'internal', c.managed, badge(c)];
  const [ka, kb] = [keys(a), keys(b)];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]!;
  const byName = a.name.localeCompare(b.name);
  return byName !== 0 ? byName < 0 : a.groupId < b.groupId;
}

/**
 * The cached sidebar with the rows of `ids` replaced by `rows` (2026-10-18): a row of `ids` that
 * `rows` lacks is gone (the group was deleted), a new one is added. Every other row keeps the
 * server's order; each patched row is put back where the server's order would place it.
 */
export function patchSidebar(
  current: SidebarClient[],
  ids: ReadonlySet<string>,
  rows: SidebarClient[],
): SidebarClient[] {
  const next = current.filter((c) => !ids.has(c.groupId));
  for (const row of rows) {
    const at = next.findIndex((c) => before(row, c));
    next.splice(at === -1 ? next.length : at, 0, row);
  }
  return next;
}

/**
 * Keeps the admin sidebar (`homeKeys.sidebar`) live (2026-10-18): it collects the groups named by
 * `admin:activity`, the ticket events, `chat:read` and `seen:changed` for 2 s, then fetches only
 * those rows (`GET /me/home/sidebar?groups=`) and patches them into the cache, instead of
 * reloading about 3 000 rows on every write anywhere. An event without a group (a ticket without
 * a client is in no row), too many groups or no cached list reload the whole list. On a hidden
 * page the work waits until it is visible again.
 */
export function useSidebarLive(): void {
  const queryClient = useQueryClient();
  const visible = useDocumentVisible();
  const visibleRef = useRef(visible);
  const pending = useRef({ ids: new Set<string>(), full: false, due: false });

  const flush = useRef(async () => {
    const { ids, full } = pending.current;
    pending.current = { ids: new Set(), full: false, due: false };
    const cached = queryClient.getQueryData<SidebarClient[]>(homeKeys.sidebar);
    if (full || !cached || ids.size > SIDEBAR_PATCH_MAX) {
      await queryClient.invalidateQueries({ queryKey: homeKeys.sidebar });
      return;
    }
    if (ids.size === 0) return;
    try {
      const rows = await apiGet(
        `/me/home/sidebar?groups=${encodeURIComponent([...ids].join(','))}`,
        SidebarSchema,
      );
      queryClient.setQueryData<SidebarClient[]>(homeKeys.sidebar, (old) =>
        old ? patchSidebar(old, ids, rows) : old,
      );
    } catch {
      await queryClient.invalidateQueries({ queryKey: homeKeys.sidebar });
    }
  });

  useEffect(() => {
    visibleRef.current = visible;
    if (visible && pending.current.due) void flush.current();
  }, [visible]);

  useEffect(() => {
    const socket = getSocket();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      pending.current.due = true;
      if (visibleRef.current) void flush.current();
    };
    const note = (groupId: string | null | undefined) => {
      if (groupId) pending.current.ids.add(groupId);
      else pending.current.full = true;
      clearTimeout(timer);
      timer = setTimeout(fire, ADMIN_ACTIVITY_DEBOUNCE_MS);
    };
    const onActivity = (e: AdminActivityEvent) => note(e.groupId);
    const onRead = (e: ChatReadEvent) => note(e.groupId);
    // An older server sends no `groupId` (undefined): reload all. A ticket without a client is in no row.
    const onSeen = (e: SeenChangedEvent) => {
      if (e.groupId !== null) note(e.groupId);
    };
    const onTicket = (e: TicketEventPayload) => {
      if (e.groupId) note(e.groupId);
    };
    const ticketEvents = Object.values(TicketEvents);
    socket.on(AdminEvents.activity, onActivity);
    socket.on(ChatEvents.read, onRead);
    socket.on(SeenEvents.changed, onSeen);
    for (const event of ticketEvents) socket.on(event, onTicket);
    return () => {
      clearTimeout(timer);
      socket.off(AdminEvents.activity, onActivity);
      socket.off(ChatEvents.read, onRead);
      socket.off(SeenEvents.changed, onSeen);
      for (const event of ticketEvents) socket.off(event, onTicket);
    };
  }, []);
}
