import type { NotificationKind, UserLanguage } from '@spolu/shared';
import { notificationGroupOf } from './categories.js';
import { buildPushPayload, isTicketEvent, meetingBody } from './push-content.js';
import { formatDay, formatReminderTime, texts } from './texts.js';

/**
 * One event in a digest email: its line, the page the email's button opens, the button's label
 * and what the subject names ("3 new messages – <topic>", the section heading).
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
 * The digest entry of one event; an email has one section per entry `url`. A ticket event (Phase 21)
 * opens the ticket's page, so each ticket gets its own section: "#123 Subject: Jana: text" for a
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
  if (row.kind === 'ticket.time_missing' || row.kind === 'task.time_missing') {
    // Phase 32: "<title>: fill in your time", opening the task or ticket with the time dialog.
    const ticket = row.kind === 'ticket.time_missing';
    const taskId = str(p.taskId);
    const title = ticket
      ? `#${Number(p.number)} ${str(p.title) ?? ''}`.trim()
      : ((taskId ? ctx.taskTitles.get(taskId) : undefined) ?? str(p.title) ?? '');
    const push = buildPushPayload({
      kind: row.kind,
      payload: p,
      groupName: ctx.groupName ?? '',
      taskTitle: null,
      parentId: null,
      lang: ctx.lang,
    });
    return {
      line: t.timeMissingLine(title),
      url: `${ctx.publicUrl}${push.url}`,
      button: ticket ? t.openTicket : t.openTask,
      topic: ticket ? t.ticketTopic(Number(p.number)) : (ctx.groupName ?? ''),
    };
  }
  if (row.kind === 'description.mention') {
    // F16: "<title>: Jana mentioned you in the description", opening the subject; one
    // section per subject. A ticket's joins the ticket's own section.
    const taskId = str(p.taskId);
    const push = buildPushPayload({
      kind: row.kind,
      payload: p,
      groupName: ctx.groupName ?? '',
      taskTitle: taskId ? (ctx.taskTitles.get(taskId) ?? null) : null,
      parentId: null,
      lang: ctx.lang,
    });
    const ticket = p.subjectKind === 'ticket';
    const subjectTitle = ticket
      ? push.title
      : ((taskId ? ctx.taskTitles.get(taskId) : undefined) ?? str(p.title) ?? '');
    return {
      line: `${subjectTitle}: ${push.body}`,
      url: `${ctx.publicUrl}${push.url}`,
      button: ticket
        ? t.openTicket
        : p.subjectKind === 'knowledge'
          ? t.openKnowledge
          : p.subjectKind === 'project'
            ? t.openProject
            : t.openTask,
      topic: ticket ? t.ticketTopic(Number(p.number)) : (ctx.groupName ?? ''),
    };
  }
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
  if (row.kind === 'reminder.due' && p.subjectKind === 'finance' && ctx.groupId === null) {
    // Phase 32 E: an item of the organisation (an expense, a contract of several clients) opens
    // on `/finance`; one section per item, never with the amount.
    const itemId = encodeURIComponent(str(p.subjectId) ?? '');
    const title = p.salary === true ? t.salaryTitle(str(p.title) ?? '') : (str(p.title) ?? '');
    const due = formatDay(str(p.dueOn), ctx.lang);
    const ends = formatDay(str(p.endsOn), ctx.lang);
    return {
      line: due
        ? t.expenseLine(title, due)
        : ends
          ? t.contractLine(title, t.financeTopic, ends)
          : t.reminderLine(title, formatReminderTime(str(p.at), ctx.lang)),
      url: `${ctx.publicUrl}/finance?item=${itemId}`,
      button: due ? t.openExpense : t.openContract,
      topic: t.financeTopic,
    };
  }
  // Only a ticket event (and a finance item of the organisation, above) may lack a client group.
  if (ctx.groupId === null || ctx.groupName === null) return null;
  if (row.kind.startsWith('meeting.')) {
    // 2026-10-17: one section per meeting, opening the item.
    const itemId = encodeURIComponent(str(p.itemId) ?? '');
    return {
      line: `${str(p.title) ?? ''}: ${meetingBody(row.kind as NotificationKind, p, ctx.lang)}`,
      url: `${ctx.publicUrl}/groups/${encodeURIComponent(ctx.groupId)}/knowledge?k=${itemId}`,
      button: t.openMeeting,
      topic: ctx.groupName,
    };
  }
  if (row.kind === 'reminder.due' && p.subjectKind === 'finance') {
    // Phase 32: one section per contract, opening the item in the client's Finance tab.
    const itemId = encodeURIComponent(str(p.subjectId) ?? '');
    const ends = formatDay(str(p.endsOn), ctx.lang);
    return {
      line: ends
        ? t.contractLine(str(p.title) ?? '', ctx.groupName, ends)
        : t.reminderLine(str(p.title) ?? '', formatReminderTime(str(p.at), ctx.lang)),
      url: `${ctx.publicUrl}/groups/${encodeURIComponent(ctx.groupId)}/finance?item=${itemId}`,
      button: t.openContract,
      topic: ctx.groupName,
    };
  }
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
