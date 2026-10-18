import type { MessageDto } from '@spolu/shared';
import type { Pending } from './channel-window';

/** Messages by the same author closer than this stack without repeating avatar and name. */
const GROUPING_WINDOW_MS = 5 * 60_000;

export type Row =
  | { kind: 'day'; date: string }
  | { kind: 'new' }
  | { kind: 'message'; message: MessageDto; showHeader: boolean; mentionsMe: boolean };

/** `YYYY-MM-DD` of a time in the viewer's local time zone. */
export function localDay(time: string | Date): string {
  const d = typeof time === 'string' ? new Date(time) : time;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The rows of a message run (oldest first): a day divider on every local day change, one "new"
 * line before the first message by someone else after `lastReadAt` (before the first one by
 * someone else when it is null), and per message whether it shows its header and whether it
 * mentions me. The main list and the thread panel both render these rows; the thread panel passes
 * `lastReadAt: undefined`, which leaves the "new" line out.
 */
export function buildRows(
  messages: MessageDto[],
  opts: { lastReadAt: string | null | undefined; meId: string; now: Date },
): Row[] {
  const readAt = opts.lastReadAt == null ? null : Date.parse(opts.lastReadAt);
  const rows: Row[] = [];
  let prev: MessageDto | null = null;
  let day = '';
  let newPlaced = opts.lastReadAt === undefined;
  for (const message of messages) {
    let separated = false;
    const messageDay = localDay(message.createdAt);
    if (messageDay !== day) {
      rows.push({ kind: 'day', date: messageDay });
      day = messageDay;
      separated = true;
    }
    const mine = message.author.id === opts.meId;
    if (!newPlaced && !mine && (readAt === null || Date.parse(message.createdAt) > readAt)) {
      rows.push({ kind: 'new' });
      newPlaced = true;
      separated = true;
    }
    const showHeader =
      separated ||
      prev === null ||
      prev.author.id !== message.author.id ||
      Date.parse(message.createdAt) - Date.parse(prev.createdAt) >= GROUPING_WINDOW_MS;
    const mentionsMe = !mine && (message.mentionsAll || message.mentions.includes(opts.meId));
    rows.push({ kind: 'message', message, showHeader, mentionsMe });
    prev = message;
  }
  return rows;
}

/** A message still being sent, shaped as a message row (no time, no actions). */
export function pendingAsMessage(
  p: Pending,
  channelId: string,
  author: MessageDto['author'],
): MessageDto {
  return {
    id: `pending:${p.clientId}`,
    channelId,
    parentId: p.input.parentId ?? null,
    replyToId: p.input.replyToId ?? null,
    author,
    body: p.input.body,
    mentions: [],
    mentionsAll: false,
    attachments: [],
    clientId: p.clientId,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: '',
    changeSeq: 0,
    tasks: [],
    reactions: [],
    knowledge: [],
    attachedTasks: [],
    attachedTickets: [],
  };
}
