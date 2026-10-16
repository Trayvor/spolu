import { asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { ChatAuthor, MessageDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getFilesForGroup } from '../files/service.js';
import { listTasksForMessages } from '../tasks/service.js';
import { user } from '../users/schema.js';
import { messageAttachments, messageMentions, messages } from './schema.js';

export type MessageRow = typeof messages.$inferSelect;

/** The message without its task links, for a reader who cannot open the group's board. */
export const withoutTaskLinks = (message: MessageDto): MessageDto =>
  message.tasks.length === 0 ? message : { ...message, tasks: [] };
export type MessageWithAuthor = MessageRow & { author: ChatAuthor };

// Deliberate read-only exception to "no other module's tables": the author's name and role are
// joined from the users table in the same query (no N+1). Writes to users go through its service.
/** Messages matching `where`, each with its author. */
export async function selectMessages(
  db: Db,
  where: SQL | undefined,
  orderBy: SQL[],
  limit?: number,
): Promise<MessageWithAuthor[]> {
  const query = db
    .select({ message: messages, authorName: user.name, authorRole: user.role })
    .from(messages)
    .innerJoin(user, eq(user.id, messages.authorId))
    .where(where)
    .orderBy(...orderBy)
    .$dynamic();
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map(({ message, authorName, authorRole }) => ({
    ...message,
    author: {
      id: message.authorId,
      name: authorName,
      isAdmin: authorRole === 'admin' || authorRole === 'superadmin',
    },
  }));
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

/**
 * Builds the DTOs with a fixed number of queries for any number of rows (mentions, attachment
 * rows and task links in parallel, then the files; none of them when no row is live). A deleted
 * message has an empty body, no mentions, no attachments and no tasks. The task links come from
 * the tasks service (the chat module never reads the tasks table itself).
 */
export async function toMessageDtos(
  db: Db,
  groupId: string,
  rows: MessageWithAuthor[],
): Promise<MessageDto[]> {
  const liveIds = rows.filter((r) => r.deletedAt === null).map((r) => r.id);
  const [mentionRows, attachmentRows, tasksOf] =
    liveIds.length === 0
      ? [[], [], new Map<string, MessageDto['tasks']>()]
      : await Promise.all([
          db.select().from(messageMentions).where(inArray(messageMentions.messageId, liveIds)),
          db
            .select()
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, liveIds))
            .orderBy(asc(messageAttachments.messageId), asc(messageAttachments.position)),
          listTasksForMessages(db, liveIds),
        ]);
  const files = await getFilesForGroup(
    db,
    groupId,
    attachmentRows.map((a) => a.fileId),
  );
  const fileById = new Map(files.map((f) => [f.id, f]));

  const mentionsOf = new Map<string, string[]>();
  for (const m of mentionRows) {
    mentionsOf.set(m.messageId, [...(mentionsOf.get(m.messageId) ?? []), m.userId]);
  }
  const attachmentsOf = new Map<string, MessageDto['attachments']>();
  for (const a of attachmentRows) {
    const file = fileById.get(a.fileId);
    if (file) attachmentsOf.set(a.messageId, [...(attachmentsOf.get(a.messageId) ?? []), file]);
  }

  return rows.map((r) => {
    const deleted = r.deletedAt !== null;
    return {
      id: r.id,
      channelId: r.channelId,
      parentId: r.parentId,
      replyToId: r.replyToId,
      author: r.author,
      body: deleted ? '' : r.body,
      mentions: deleted ? [] : (mentionsOf.get(r.id) ?? []),
      mentionsAll: deleted ? false : r.mentionsAll,
      attachments: deleted ? [] : (attachmentsOf.get(r.id) ?? []),
      clientId: r.clientId,
      replyCount: r.replyCount,
      lastReplyAt: iso(r.lastReplyAt),
      editedAt: iso(r.editedAt),
      deletedAt: iso(r.deletedAt),
      createdAt: r.createdAt.toISOString(),
      changeSeq: r.changeSeq,
      tasks: deleted ? [] : (tasksOf.get(r.id) ?? []),
    };
  });
}
