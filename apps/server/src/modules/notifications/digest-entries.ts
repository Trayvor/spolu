import type { NotificationKind, UserLanguage } from '@spolu/shared';
import { notificationGroupOf } from './categories.js';
import { buildPushPayload, isTicketEvent } from './push-content.js';
import { formatReminderTime, texts } from './texts.js';

/**
 * One event in a digest email: its line, the page the email's button opens, the button's label
 * and what the subject names ("3 new messages in <topic>").
 */
export type DigestEntry = { line: string; url: string; button: string; topic: string };

export type DigestContext = {
  /** Null for a ticket event without a client group. */
  groupName: string | null;
  groupId: string | null;
  publicUrl: string;
  lang: UserLanguage;
  /** Current task titles by id, so task lines show the task's title now. */
  taskTitles: Map<string, string>;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The digest entry of one event; emails are split by the entries' `url`. A ticket event (Phase 21)
 * opens the ticket's page, so each ticket gets its own email: "#123 Subject: Jana: text" for a
 * message or a mention, "<what happened>: <subject>" otherwise, and "Open ticket". Every other
 * kind opens the group chat. A kind it does not know gives null and is left out of the email.
 */
export function digestEntry(
  row: { kind: string; payload: Record<string, unknown> },
  ctx: DigestContext,
): DigestEntry | null {
  const group = notificationGroupOf(row.kind, row.payload);
  if (group === null) return null;
  const t = texts(ctx.lang);
  const p = row.payload;
  if (group === 'tickets' && isTicketEvent(row.kind, p)) {
    const push = buildPushPayload({
      kind: row.kind as NotificationKind,
      payload: p,
      groupName: ctx.groupName ?? '',
      taskTitle: null,
      parentId: null,
      lang: ctx.lang,
    });
    return {
      line: push.body === '' ? push.title : `${push.title}: ${push.body}`,
      url: `${ctx.publicUrl}${push.url}`,
      button: t.openTicket,
      topic: t.ticketTopic(Number(p.number)),
    };
  }
  // Only a ticket event may lack a client group.
  if (ctx.groupId === null || ctx.groupName === null) return null;
  const taskId = str(p.taskId);
  const title = (taskId ? ctx.taskTitles.get(taskId) : undefined) ?? str(p.title);
  let line: string;
  if (row.kind === 'reminder.due') {
    line = t.reminderLine(title ?? '', formatReminderTime(str(p.at), ctx.lang));
  } else {
    const body = buildPushPayload({
      kind: row.kind as NotificationKind,
      payload: p,
      groupName: ctx.groupName,
      taskTitle: title,
      parentId: null,
      lang: ctx.lang,
    }).body;
    line = str(p.messageId) === null && title ? `${body}: ${title}` : body;
  }
  return {
    line,
    url: `${ctx.publicUrl}/groups/${encodeURIComponent(ctx.groupId)}/chat`,
    button: t.digestButton(ctx.groupName),
    topic: ctx.groupName,
  };
}
