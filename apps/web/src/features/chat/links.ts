const enc = encodeURIComponent;

type LinkedMessage = {
  messageId: string;
  channelId: string;
  taskId: string | null;
  /** Set for a message of a ticket chat (Phase 21): it opens on the ticket's page. */
  ticketId?: string | null;
  /** The thread's root of a reply: the link opens that thread too. */
  parentId?: string | null;
};

/**
 * The one place a link to a chat message is built, as a router location for `<Link>` (in-app
 * navigation, so route guards such as the task panel's unsaved-changes question apply). The
 * routes declare no search schema. `chatMessageHref` is the same link as a string.
 */
export function chatMessageLocation(groupId: string, m: LinkedMessage) {
  const search = {
    ...(m.parentId ? { thread: m.parentId } : {}),
    message: m.messageId,
    c: m.channelId,
  };
  if (m.ticketId) {
    return { to: '/tickets/$ticketId' as const, params: { ticketId: m.ticketId }, search };
  }
  return m.taskId === null
    ? { to: '/groups/$groupId/chat' as const, params: { groupId }, search }
    : {
        to: '/groups/$groupId/tasks/$taskId' as const,
        params: { groupId, taskId: m.taskId },
        search: { tab: 'chat', ...search },
      };
}

/**
 * The link to one chat message, as a string: `chatMessageLocation` written out, so both always
 * agree. The group's Chat tab for a group chat message, the task panel's Chat tab for a task chat
 * message, the ticket page for a ticket chat message. `c` scopes the params to that chat (see `useChatSearch`).
 */
export function chatMessageHref(groupId: string, m: LinkedMessage): string {
  const { to, params, search } = chatMessageLocation(groupId, m);
  const values: Partial<Record<string, string>> = params;
  const path = to.replace(/\$(\w+)/g, (_, name: string) => enc(values[name] ?? ''));
  const query = Object.entries(search)
    .map(([key, value]) => `${key}=${enc(value)}`)
    .join('&');
  return `${path}?${query}`;
}
