/** Every kind of notification event; declared up front so chat and tasks add no edits here. */
export const NotificationKinds = [
  'chat.message',
  'chat.mention',
  'chat.thread_reply',
  'task.moved',
  'task.assigned',
] as const;
export type NotificationKind = (typeof NotificationKinds)[number];
