const enc = encodeURIComponent;

/**
 * The link to one chat message: the group's Chat tab for a group chat message, the task panel's
 * Chat tab for a task chat message. `c` scopes the params to that chat (see `useChatSearch`).
 */
export function chatMessageHref(
  groupId: string,
  m: { messageId: string; channelId: string; taskId: string | null },
): string {
  const params = `message=${enc(m.messageId)}&c=${enc(m.channelId)}`;
  return m.taskId === null
    ? `/groups/${enc(groupId)}/chat?${params}`
    : `/groups/${enc(groupId)}/tasks/${enc(m.taskId)}?tab=chat&${params}`;
}
