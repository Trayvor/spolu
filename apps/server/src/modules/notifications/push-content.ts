import type {
  BucketLabel,
  NotificationKind,
  PushPayload,
  TicketStatus,
  UserLanguage,
} from '@spolu/shared';
import { formatReminderClock, formatReminderTime, texts } from './texts.js';

const EXCERPT_MAX = 120;

export type PushContentInput = {
  kind: NotificationKind;
  payload: Record<string, unknown>;
  groupName: string;
  taskTitle: string | null;
  parentId: string | null;
  lang: UserLanguage;
  /** When the push is built (default now): a task reminder sent late names its day. */
  now?: Date;
};

/** A task reminder delivered more than this after its time names the day, not only the clock. */
const LATE_REMINDER_MS = 5 * 60_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const enc = encodeURIComponent;

function chatBody(p: Record<string, unknown>, lang: UserLanguage): string {
  const author = str(p.authorName) ?? '';
  const excerpt = (str(p.excerpt) ?? '').trim();
  if (excerpt === '') return texts(lang).sentFile(author);
  const chars = Array.from(excerpt);
  const cut = chars.length > EXCERPT_MAX ? `${chars.slice(0, EXCERPT_MAX).join('')}…` : excerpt;
  return `${author}: ${cut}`;
}

const BUCKET_KINDS = ['todo', 'egrant_review', 'client_review', 'done', 'custom'];

function movedBody(toBucket: unknown, lang: UserLanguage): string {
  const t = texts(lang);
  const b = toBucket as Partial<BucketLabel> | null | undefined;
  if (!b || typeof b !== 'object' || typeof b.kind !== 'string' || !BUCKET_KINDS.includes(b.kind)) {
    return t.movedGeneric;
  }
  return t.moved(t.bucket({ kind: b.kind, name: typeof b.name === 'string' ? b.name : null }));
}

/** Whether the event is about a ticket: a `ticket.*` kind, or a mention in a ticket chat. */
export function isTicketEvent(kind: string, payload: Record<string, unknown>): boolean {
  return kind.startsWith('ticket.') || str(payload.ticketId) !== null;
}

/**
 * A ticket's push (Phase 21): a message or a mention is titled "#123 Subject" with "Jana: text";
 * the other kinds say what happened in the title and show the subject. Every ticket push opens
 * the ticket's page and shares its device tag.
 */
function ticketPush(i: PushContentInput): PushPayload {
  const t = texts(i.lang);
  const p = i.payload;
  const id = str(p.ticketId) ?? '';
  const n = Number(p.number);
  const subject = str(p.subject);
  const named = subject ? `#${n} ${subject}` : `#${n}`;
  let title: string;
  let body = subject ?? '';
  if (i.kind === 'ticket.created') title = t.ticketNew(n, i.groupName);
  else if (i.kind === 'ticket.unassigned') title = t.ticketUnassigned(n);
  else if (i.kind === 'ticket.status') title = t.ticketStatus(n, p.status as TicketStatus);
  else if (i.kind === 'ticket.updated') title = t.ticketUpdated(n);
  else if (i.kind === 'ticket.assigned') title = t.ticketAssigned(n);
  else if (i.kind === 'ticket.tasks') title = t.ticketTasks(n, Number(p.count));
  else {
    title = named;
    body = chatBody(p, i.lang);
  }
  return { title, body, url: `/tickets/${enc(id)}`, tag: `ticket:${id}` };
}

/** What a meeting event says (2026-10-17): the start in Bratislava time, or the AI result. */
export function meetingBody(
  kind: NotificationKind,
  p: Record<string, unknown>,
  lang: UserLanguage,
): string {
  const t = texts(lang);
  const when = formatReminderTime(str(p.startsAt), lang);
  if (kind === 'meeting.scheduled') return t.meetingScheduled(when);
  if (kind === 'meeting.rescheduled') return t.meetingRescheduled(when);
  if (kind === 'meeting.summary_ready') return t.meetingSummaryReady;
  return t.meetingSummaryFailed;
}

/**
 * A meeting's push: "<title> · <client>" with what happened; it opens the item in the group's
 * Knowledge tab and shares the device tag of the meeting's reminder.
 */
function meetingPush(i: PushContentInput): PushPayload {
  const p = i.payload;
  const itemId = str(p.itemId) ?? '';
  return {
    title: `${str(p.title) ?? ''} · ${i.groupName}`,
    body: meetingBody(i.kind, p, i.lang),
    url: `/groups/${enc(str(p.groupId) ?? '')}/knowledge?k=${enc(itemId)}`,
    tag: `knowledge:${itemId}`,
  };
}

export function buildPushPayload(i: PushContentInput): PushPayload {
  const t = texts(i.lang);
  const p = i.payload;
  if (isTicketEvent(i.kind, p)) return ticketPush(i);
  const groupId = enc(str(p.groupId) ?? '');
  const taskId = str(p.taskId);
  const title =
    taskId && (i.taskTitle ?? str(p.title))
      ? `${i.taskTitle ?? str(p.title)} · ${i.groupName}`
      : i.groupName;

  if (i.kind === 'reminder.due' && p.subjectKind === 'task') {
    // Shares the URL and the tag of the automatic task reminders: one notification per task on
    // the device.
    const at = str(p.at);
    const late = (i.now ?? new Date()).getTime() - new Date(at ?? NaN).getTime() > LATE_REMINDER_MS;
    return {
      title,
      body: t.reminderDue(late ? formatReminderTime(at, i.lang) : formatReminderClock(at, i.lang)),
      url: `/groups/${groupId}/tasks/${enc(taskId ?? '')}`,
      tag: `task:${taskId ?? ''}`,
    };
  }

  if (i.kind.startsWith('meeting.')) return meetingPush(i);

  if (i.kind === 'reminder.due') {
    const subjectId = str(p.subjectId) ?? '';
    return {
      title: `${str(p.title) ?? ''} · ${i.groupName}`,
      body: t.reminderDue(formatReminderTime(str(p.at), i.lang)),
      url: `/groups/${groupId}/knowledge?k=${enc(subjectId)}`,
      tag: `knowledge:${subjectId}`,
    };
  }

  if (i.kind.startsWith('task.')) {
    const url = `/groups/${groupId}/tasks/${enc(taskId ?? '')}`;
    const tag = `task:${taskId ?? ''}`;
    let body: string;
    if (i.kind === 'task.moved') body = movedBody(p.toBucket, i.lang);
    else if (i.kind === 'task.assigned') body = t.assigned(str(p.actorName) ?? '');
    else if (i.kind === 'task.deadline') body = t.deadline(Number(p.daysLeft));
    else body = t.urgent;
    return { title, body, url, tag };
  }

  const messageId = enc(str(p.messageId) ?? '');
  const channelId = str(p.channelId) ?? '';
  const thread = i.parentId ? `thread=${enc(i.parentId)}&` : '';
  // `c` scopes the params to the task chat (the web's `useChatSearch`): the task panel ignores
  // unscoped ones, which only the group's Chat tab adopts.
  const url = taskId
    ? `/groups/${groupId}/tasks/${enc(taskId)}?tab=chat&${thread}message=${messageId}&c=${enc(channelId)}`
    : `/groups/${groupId}/chat?${thread}message=${messageId}`;
  const tag = i.parentId ? `thread:${i.parentId}` : `chat:${channelId}`;
  return { title, body: chatBody(p, i.lang), url, tag };
}
