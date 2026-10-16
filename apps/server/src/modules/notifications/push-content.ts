import type { BucketLabel, NotificationKind, PushPayload, UserLanguage } from '@spolu/shared';
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

export function buildPushPayload(i: PushContentInput): PushPayload {
  const t = texts(i.lang);
  const p = i.payload;
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
