import type {
  BucketLabel,
  NotificationKind,
  PushAction,
  PushPayload,
  TicketStatus,
  UserLanguage,
} from '@spolu/shared';
import { formatDay, formatReminderClock, formatReminderTime, texts } from './texts.js';

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
  if (i.kind === 'ticket.time_missing') {
    // Phase 32: the payload names the subject `title`; it opens the ticket with the time dialog.
    const title = str(p.title) ? `#${n} ${str(p.title)}` : named;
    return {
      // A ticket without a client (decision 24) names no client.
      title: i.groupName ? `${title} · ${i.groupName}` : title,
      body: t.timeMissing,
      url: `/tickets/${enc(id)}?time=1`,
      tag: `ticket:${id}`,
    };
  }
  let title: string;
  let body = subject ?? '';
  if (i.kind === 'ticket.created') title = t.ticketNew(n, i.groupName);
  else if (i.kind === 'ticket.unassigned') title = t.ticketUnassigned(n);
  else if (i.kind === 'ticket.status') title = t.ticketStatus(n, p.status as TicketStatus);
  else if (i.kind === 'ticket.updated') title = t.ticketUpdated(n);
  else if (i.kind === 'ticket.assigned') title = t.ticketAssigned(n);
  else if (i.kind === 'ticket.resolved') title = t.ticketResolved(n);
  // 2026-10-19: a 👎 rating; the payload carries the value only, never the comment.
  else if (i.kind === 'ticket.rated') title = t.ticketRated(n);
  else if (i.kind === 'ticket.tasks') title = t.ticketTasks(n, Number(p.count));
  else {
    title = named;
    body = chatBody(p, i.lang);
  }
  // 2026-10-19: the resolved notice opens the rating card (`?rate=1` writes nothing).
  const rate = i.kind === 'ticket.resolved' ? '?rate=1' : '';
  return { title, body, url: `/tickets/${enc(id)}${rate}`, tag: `ticket:${id}` };
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

/**
 * F16: a mention in a description says "Jana mentioned you in the description" under the
 * subject's title and opens the subject: the task panel, the ticket, the project on the Prehľad
 * tab or the knowledge item. It shares the subject's device tag.
 */
function descriptionPush(i: PushContentInput): PushPayload {
  const p = i.payload;
  const body = texts(i.lang).mentionedInDescription(str(p.actorName) ?? '');
  const id = str(p.subjectId) ?? '';
  const groupId = enc(str(p.groupId) ?? '');
  const withGroup = (title: string) => (i.groupName ? `${title} · ${i.groupName}` : title);
  switch (p.subjectKind) {
    case 'ticket': {
      const subject = str(p.subject);
      const n = Number(p.number);
      return {
        title: subject ? `#${n} ${subject}` : `#${n}`,
        body,
        url: `/tickets/${enc(id)}`,
        tag: `ticket:${id}`,
      };
    }
    case 'knowledge':
      return {
        title: withGroup(str(p.title) ?? ''),
        body,
        url: `/groups/${groupId}/knowledge?k=${enc(id)}`,
        tag: `knowledge:${id}`,
      };
    case 'project':
      return {
        title: withGroup(str(p.title) ?? ''),
        body,
        url: `/groups/${groupId}/overview?project=${enc(id)}`,
        tag: `project:${id}`,
      };
    default:
      return {
        title: withGroup(i.taskTitle ?? str(p.title) ?? ''),
        body,
        url: `/groups/${groupId}/tasks/${enc(id)}`,
        tag: `task:${id}`,
      };
  }
}

/**
 * The kinds that alert again when they replace a shown notification of the same tag (N1 of the
 * 2026-10-18 UX review): what is addressed to the person (a mention, an assignment, a new ticket
 * they watch, its outcome, a time request) or due now (reminders, deadline, urgent, overdue). Every
 * other kind (messages, thread replies, moves and other updates) replaces its card silently, so
 * five messages in a row make one sound, not five.
 */
const RENOTIFY = new Set<NotificationKind>([
  'chat.mention',
  'description.mention',
  'task.assigned',
  'task.deadline',
  'task.urgent',
  'task.overdue',
  'task.time_missing',
  'reminder.due',
  'ticket.created',
  'ticket.unassigned',
  'ticket.assigned',
  'ticket.resolved',
  'ticket.rated',
  'ticket.time_missing',
  'meeting.summary_ready',
  'meeting.summary_failed',
]);

/** What the service worker shows for one event (`push-sw.js`, its buttons `push-actions.js`). */
export function buildPushPayload(i: PushContentInput): PushPayload {
  const content = pushContent(i);
  const actions = pushActions(i, content.url);
  return {
    ...content,
    ...(RENOTIFY.has(i.kind) && { renotify: true as const }),
    ...(actions && { actions }),
  };
}

/** The pushes about an open task addressed to the person, which get "Done" (N6a). */
const DONE_KINDS = new Set<NotificationKind>([
  'task.assigned',
  'task.deadline',
  'task.urgent',
  'task.overdue',
  'task.due_changed',
]);
/** The pushes about a message, which get "Reply" (N6a). */
const REPLY_KINDS = new Set<NotificationKind>([
  'chat.message',
  'chat.mention',
  'chat.thread_reply',
  'ticket.message',
]);

/**
 * N6a of the 2026-10-18 UX review (ADR 0047): one contextual button. "Log time" on a time request
 * (it opens the push's own URL, the time dialog); "Done" on what asks the person to do a task;
 * "Reply" on a message, with the chat (scoped by `c`, its thread open) and `reply=1` to focus the
 * composer where the platform has no inline reply. Finance, meeting, knowledge and other ticket
 * pushes get none. Only ids the URL already carries.
 */
function pushActions(i: PushContentInput, url: string): PushAction[] | undefined {
  const t = texts(i.lang);
  const p = i.payload;
  if (i.kind === 'task.time_missing' || i.kind === 'ticket.time_missing') {
    return [{ action: 'time', title: t.actionLogTime, url }];
  }
  const taskId = str(p.taskId);
  const taskReminder = i.kind === 'reminder.due' && p.subjectKind === 'task';
  if (taskId && (DONE_KINDS.has(i.kind) || taskReminder)) {
    return [{ action: 'done', title: t.actionDone, taskId }];
  }
  const channelId = str(p.channelId);
  const messageId = str(p.messageId);
  if (!REPLY_KINDS.has(i.kind) || !channelId || !messageId) return undefined;
  const chat = `${i.parentId ? `thread=${enc(i.parentId)}&` : ''}message=${enc(messageId)}&c=${enc(channelId)}`;
  const ticketId = isTicketEvent(i.kind, p) ? str(p.ticketId) : null;
  const groupId = enc(str(p.groupId) ?? '');
  const place = ticketId
    ? `/tickets/${enc(ticketId)}?${chat}`
    : taskId
      ? `/groups/${groupId}/tasks/${enc(taskId)}?tab=chat&${chat}`
      : `/groups/${groupId}/chat?${chat}`;
  return [
    {
      action: 'reply',
      title: t.actionReply,
      placeholder: t.replyPlaceholder,
      channelId,
      parentId: i.parentId,
      url: `${place}&reply=1`,
    },
  ];
}

function pushContent(i: PushContentInput): PushPayload {
  const t = texts(i.lang);
  const p = i.payload;
  if (i.kind === 'description.mention') return descriptionPush(i);
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

  if (i.kind === 'reminder.due' && p.subjectKind === 'finance') {
    // Phase 32: a contract's reminder opens the item in the client's Finance tab; no money. An
    // item of the organisation (Phase 32 E: an expense, a contract of several clients) opens on
    // `/finance`; an expense says when it is due, a salary names its admin.
    const subjectId = str(p.subjectId) ?? '';
    const ends = formatDay(str(p.endsOn), i.lang);
    const due = formatDay(str(p.dueOn), i.lang);
    const name = p.salary === true ? t.salaryTitle(str(p.title) ?? '') : (str(p.title) ?? '');
    const organisation = str(p.groupId) === null;
    return {
      title: organisation ? name : `${name} · ${i.groupName}`,
      body: due
        ? t.expenseDue(due)
        : ends
          ? t.contractEnds(ends)
          : t.reminderDue(formatReminderTime(str(p.at), i.lang)),
      url: organisation
        ? `/finance?item=${enc(subjectId)}`
        : `/groups/${groupId}/finance?item=${enc(subjectId)}`,
      tag: `finance:${subjectId}`,
    };
  }

  if (i.kind === 'reminder.due' && p.subjectKind === 'event') {
    // F15: a project event's reminder opens the event sheet on the client's Prehľad tab.
    const subjectId = str(p.subjectId) ?? '';
    return {
      title: `${str(p.title) ?? ''} · ${i.groupName}`,
      body: t.reminderDue(formatReminderTime(str(p.at), i.lang)),
      url: `/groups/${groupId}/overview?event=${enc(subjectId)}`,
      tag: `event:${subjectId}`,
    };
  }

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
    else if (i.kind === 'task.due_changed') {
      const due = formatDay(str(p.dueDate), i.lang);
      body = due ? t.dueChanged(due) : t.dueRemoved;
    } else if (i.kind === 'task.overdue') body = t.overdue(formatDay(str(p.dueDate), i.lang));
    else if (i.kind === 'task.time_missing') {
      // Phase 32: opens the task panel with the time dialog.
      return { title, body: t.timeMissing, url: `${url}?time=1`, tag };
    } else body = t.urgent;
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
