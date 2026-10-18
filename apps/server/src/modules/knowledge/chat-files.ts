import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { KNOWLEDGE_LIMITS, type Visibility } from '@spolu/shared';
import { onChatFiles, type ChatFileListener } from '../chat/file-hooks.js';
import { getFilesForGroup } from '../files/service.js';
import { adminGroupId } from '../groups/admin-group.js';
import { emitKnowledgeDeleted, emitKnowledgeItem } from './events.js';
import { knowledgeItems } from './schema.js';
import { normalizeSearch } from '../../infra/text/search.js';
import { chatFileSummaries } from './service.js';

/**
 * Who reads a chat's files in the knowledge base. Every chat of a group (its group chat, task
 * chats and ticket chats) is read by all admins and the group's clients, the same people who
 * read the group's public knowledge; a ziadatel never reads knowledge. So every chat file is a
 * public item. The admin group's chats (Phase 34) are read by admins only: their files are
 * "Only eGrant" items, so they never become shareable with clients by accident.
 */
function chatFileVisibility(inAdminGroup: boolean): Visibility {
  return inAdminGroup ? 'admins' : 'public';
}

const listener: ChatFileListener = {
  /** One `chat_file` item per file, in the send's transaction. */
  async attached(tx, change) {
    const fileRows = await getFilesForGroup(tx, change.channel.groupId, change.fileIds);
    if (fileRows.length === 0) return;
    const visibility = chatFileVisibility((await adminGroupId(tx)) === change.channel.groupId);
    await tx
      .insert(knowledgeItems)
      .values(
        fileRows.map((file) => ({
          id: randomUUID(),
          groupId: change.channel.groupId,
          type: 'chat_file',
          visibility,
          title: file.name.slice(0, KNOWLEDGE_LIMITS.title),
          body: '',
          url: null,
          folderId: null,
          createdBy: change.authorId,
          createdAt: change.createdAt,
          updatedAt: change.createdAt,
          searchText: normalizeSearch(file.name),
          chatMessageId: change.messageId,
          chatFileId: file.id,
          chatChannelId: change.channel.id,
          chatKind: change.channel.kind,
        })),
      )
      .onConflictDoNothing();
  },

  /** A ticket's chat moved to another group: its entries follow, in the same transaction. */
  async moved(tx, change) {
    await tx
      .update(knowledgeItems)
      .set({ groupId: change.groupId, updatedAt: sql`now()` })
      .where(eq(knowledgeItems.chatChannelId, change.channelId));
  },

  async sent(db, io, messageId) {
    for (const item of await chatFileSummaries(db, messageId)) emitKnowledgeItem(io, item);
  },

  async removing(db, messageId) {
    const rows = await db
      .select({
        id: knowledgeItems.id,
        groupId: knowledgeItems.groupId,
        visibility: knowledgeItems.visibility,
      })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.chatMessageId, messageId));
    return (io) => {
      for (const row of rows) {
        emitKnowledgeDeleted(io, { ...row, visibility: row.visibility as Visibility });
      }
    };
  },
};

/** The knowledge base follows the files of chat messages ("From chat"). Call once at start-up. */
export function registerKnowledgeChatFiles(): void {
  onChatFiles(listener);
}
