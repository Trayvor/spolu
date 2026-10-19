import { asc, eq, getTableColumns, inArray, type SQL } from 'drizzle-orm';
import type { ChatAuthor, MessageDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getFilesForGroup } from '../files/service.js';
import { listTasksForMessages } from '../tasks/service.js';
import { user } from '../users/schema.js';
import { loadMessageKnowledge } from './knowledge-links.js';
import { loadReactions } from './reactions.js';
import { loadMessageWork } from './work-links.js';
import { messageAttachments, messageMentions, messages } from './schema.js';

// The message reads leave out `search_text` (a folded copy of the body, for search only).
const { searchText, ...messageColumns } = getTableColumns(messages);
void searchText;
/** The columns of a message row, without `search_text`. */
export { messageColumns };

export type MessageRow = Omit<typeof messages.$inferSelect, 'searchText'>;

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
    .select({ message: messageColumns, authorName: user.name, authorRole: user.role })
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
 * rows, task links, reactions and knowledge rows in parallel, then the files and the knowledge
 * cards; none of them when no row is live). A deleted message has an empty body, no mentions,
 * attachments, tasks, reactions or knowledge items. The task links come from the tasks service
 * and the knowledge cards from the knowledge module (the chat never reads their tables).
 */
export async function toMessageDtos(
  db: Db,
  groupId: string,
  rows: MessageWithAuthor[],
): Promise<MessageDto[]> {
  const liveIds = rows.filter((r) => r.deletedAt === null).map((r) => r.id);
  const [mentionRows, attachmentRows, tasksOf, reactionsOf, knowledgeOf, workOf] =
    liveIds.length === 0
      ? [
          [],
          [],
          new Map<string, MessageDto['tasks']>(),
          new Map<string, MessageDto['reactions']>(),
          new Map<string, MessageDto['knowledge']>(),
          {
            tasks: new Map<string, MessageDto['attachedTasks']>(),
            tickets: new Map<string, MessageDto['attachedTickets']>(),
          },
        ]
      : await Promise.all([
          db.select().from(messageMentions).where(inArray(messageMentions.messageId, liveIds)),
          db
            .select()
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, liveIds))
            .orderBy(asc(messageAttachments.messageId), asc(messageAttachments.position)),
          listTasksForMessages(db, liveIds),
          loadReactions(db, liveIds),
          loadMessageKnowledge(db, groupId, liveIds),
          loadMessageWork(db, groupId, liveIds),
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
      reactions: deleted ? [] : (reactionsOf.get(r.id) ?? []),
      knowledge: deleted ? [] : (knowledgeOf.get(r.id) ?? []),
      attachedTasks: deleted ? [] : (workOf.tasks.get(r.id) ?? []),
      attachedTickets: deleted ? [] : (workOf.tickets.get(r.id) ?? []),
    };
  });
}
