import type { BucketLabel, NotificationKind, PushPayload, UserLanguage } from '@spolu/shared';
import { texts } from './texts.js';

const EXCERPT_MAX = 120;

export type PushContentInput = {
  kind: NotificationKind;
  payload: Record<string, unknown>;
  groupName: string;
  taskTitle: string | null;
  parentId: string | null;
  lang: UserLanguage;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const enc = encodeURIComponent;

function chatBody(p: Record<string, unknown>, lang: UserLanguage): string {
  const author = str(p.authorName) ?? '';
  const excerpt = (str(p.excerpt) ?? '').trim();
  if (excerpt === '') return texts(lang).sentFile(author);
  const cut = excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX)}…` : excerpt;
  return `${author}: ${cut}`;
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

  if (i.kind.startsWith('task.')) {
    const url = `/groups/${groupId}/tasks/${enc(taskId ?? '')}`;
    const tag = `task:${taskId ?? ''}`;
    let body: string;
    if (i.kind === 'task.moved') body = t.moved(t.bucket(p.toBucket as BucketLabel));
    else if (i.kind === 'task.assigned') body = t.assigned(str(p.actorName) ?? '');
    else if (i.kind === 'task.deadline') body = t.deadline(Number(p.daysLeft));
    else body = t.urgent;
    return { title, body, url, tag };
  }

  const messageId = enc(str(p.messageId) ?? '');
  const channelId = str(p.channelId) ?? '';
  const thread = i.parentId ? `thread=${enc(i.parentId)}&` : '';
  const url = taskId
    ? `/groups/${groupId}/tasks/${enc(taskId)}?tab=chat&${thread}message=${messageId}`
    : `/groups/${groupId}/chat?${thread}message=${messageId}`;
  const tag = i.parentId ? `thread:${i.parentId}` : `chat:${channelId}`;
  return { title, body: chatBody(p, i.lang), url, tag };
}
