const enc = encodeURIComponent;

type LinkedMessage = { messageId: string; channelId: string; taskId: string | null };

/**
 * `chatMessageHref` as a router location, for `<Link>` (in-app navigation, so route guards such
 * as the task panel's unsaved-changes question apply). The routes declare no search schema.
 */
export function chatMessageLocation(groupId: string, m: LinkedMessage) {
  const search = { message: m.messageId, c: m.channelId };
  return m.taskId === null
    ? { to: '/groups/$groupId/chat' as const, params: { groupId }, search }
    : {
        to: '/groups/$groupId/tasks/$taskId' as const,
        params: { groupId, taskId: m.taskId },
        search: { tab: 'chat', ...search },
      };
}

/**
 * The link to one chat message: the group's Chat tab for a group chat message, the task panel's
 * Chat tab for a task chat message. `c` scopes the params to that chat (see `useChatSearch`).
 */
export function chatMessageHref(groupId: string, m: LinkedMessage): string {
  const params = `message=${enc(m.messageId)}&c=${enc(m.channelId)}`;
  return m.taskId === null
    ? `/groups/${enc(groupId)}/chat?${params}`
    : `/groups/${enc(groupId)}/tasks/${enc(m.taskId)}?tab=chat&${params}`;
}
