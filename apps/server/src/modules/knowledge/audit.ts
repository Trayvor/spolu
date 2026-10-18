import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AuditAction } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges, type FieldValues } from '../audit/diff.js';
import { registerAuditResolver } from '../audit/resolvers.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';
import { fileNames } from '../files/service.js';
import {
  knowledgeAttachments,
  knowledgeFolders,
  knowledgeItems,
  knowledgeLinks,
  knowledgeMeetings,
} from './schema.js';

/**
 * The knowledge module's audit rows (spec §3.1): what an item looks like to the log, with its
 * folder's, linked items' and files' labels, in a fixed number of queries for any number of
 * items (an "all following" edit of a series changes many). The body, the transcript and the
 * summary are text: only "changed", never their content.
 */
export type KnowledgeAuditSnapshot = {
  id: string;
  groupId: string;
  title: string;
  values: FieldValues;
};

export async function knowledgeSnapshots(
  db: Db,
  ids: string[],
): Promise<Map<string, KnowledgeAuditSnapshot>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: knowledgeItems.id,
      groupId: knowledgeItems.groupId,
      type: knowledgeItems.type,
      title: knowledgeItems.title,
      visibility: knowledgeItems.visibility,
      body: knowledgeItems.body,
      url: knowledgeItems.url,
      folderId: knowledgeItems.folderId,
      folderName: knowledgeFolders.name,
      startsAt: knowledgeMeetings.startsAt,
      transcript: knowledgeMeetings.transcript,
      summary: knowledgeMeetings.summary,
    })
    .from(knowledgeItems)
    .leftJoin(knowledgeFolders, eq(knowledgeFolders.id, knowledgeItems.folderId))
    .leftJoin(knowledgeMeetings, eq(knowledgeMeetings.itemId, knowledgeItems.id))
    .where(inArray(knowledgeItems.id, ids));
  if (rows.length === 0) return new Map();
  const found = rows.map((r) => r.id);
  const [links, attachments] = await Promise.all([
    db
      .select({
        subjectId: knowledgeLinks.knowledgeItemId,
        itemId: knowledgeLinks.itemId,
        title: knowledgeItems.title,
      })
      .from(knowledgeLinks)
      .leftJoin(knowledgeItems, eq(knowledgeItems.id, knowledgeLinks.itemId))
      .where(
        and(
          isNotNull(knowledgeLinks.knowledgeItemId),
          inArray(knowledgeLinks.knowledgeItemId, found),
        ),
      )
      .orderBy(asc(knowledgeLinks.position)),
    db
      .select({ itemId: knowledgeAttachments.itemId, fileId: knowledgeAttachments.fileId })
      .from(knowledgeAttachments)
      .where(inArray(knowledgeAttachments.itemId, found)),
  ]);
  const files = await fileNames(
    db,
    attachments.map((a) => a.fileId),
  );
  return new Map(
    rows.map((r) => {
      const values: FieldValues = {
        title: r.title,
        type: r.type,
        visibility: r.visibility,
        folder: r.folderId ? { id: r.folderId, label: r.folderName ?? r.folderId } : null,
        body: r.body,
        url: r.url,
        meetingAt: r.startsAt,
        transcript: r.transcript,
        summary: r.summary === null || r.summary === undefined ? null : JSON.stringify(r.summary),
        links: links
          .filter((l) => l.subjectId === r.id)
          .map((l) => ({ id: l.itemId, label: l.title ?? l.itemId })),
        files: attachments
          .filter((a) => a.itemId === r.id)
          .map((a) => ({ id: a.fileId, label: files.get(a.fileId) ?? a.fileId })),
      };
      return [r.id, { id: r.id, groupId: r.groupId, title: r.title, values }];
    }),
  );
}

const itemEntry = (
  s: KnowledgeAuditSnapshot,
  action: AuditAction,
  changes: AuditEntry['changes'],
): AuditEntry => ({
  entityType: 'knowledge_item',
  entityId: s.id,
  entityLabel: s.title,
  groupId: s.groupId,
  action,
  changes,
});

/** Records `created` (initial values) or `deleted` for the items as they are now, one insert. */
export async function recordItems(
  tx: Db,
  by: AuditActor | undefined,
  ids: string[],
  action: 'created' | 'deleted',
): Promise<void> {
  if (!by || ids.length === 0) return;
  const snapshots = await knowledgeSnapshots(tx, ids);
  await recordAudit(
    tx,
    by,
    ids.flatMap((id) => {
      const s = snapshots.get(id);
      if (!s) return [];
      return [
        itemEntry(
          s,
          action,
          action === 'created'
            ? diffFields('knowledge_item', null, s.values)
            : diffFields('knowledge_item', s.values, null),
        ),
      ];
    }),
  );
}

/** The `updated` entry of an item against `before`, or null when no audited field changed. */
export async function itemUpdateEntry(
  tx: Db,
  before: KnowledgeAuditSnapshot | undefined,
): Promise<AuditEntry | null> {
  if (!before) return null;
  const after = (await knowledgeSnapshots(tx, [before.id])).get(before.id);
  if (!after) return null;
  const changes = diffFields('knowledge_item', before.values, after.values);
  return hasChanges(changes) ? itemEntry(after, 'updated', changes) : null;
}

/** Records the `updated` rows of an edit (one insert for an "all following" edit). */
export async function recordItemUpdates(
  tx: Db,
  by: AuditActor | undefined,
  entries: (AuditEntry | null)[],
): Promise<void> {
  const rows = entries.filter((e): e is AuditEntry => e !== null);
  if (by && rows.length > 0) await recordAudit(tx, by, rows);
}

/** `updated` with one text field (the transcript, the summary) as changed, never its text. */
export async function recordTextChange(
  tx: Db,
  by: AuditActor,
  itemId: string,
  field: 'transcript' | 'summary' | 'body',
): Promise<void> {
  const [item] = await tx
    .select({ title: knowledgeItems.title, groupId: knowledgeItems.groupId })
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, itemId));
  if (!item) return;
  await recordAudit(tx, by, [
    {
      entityType: 'knowledge_item',
      entityId: itemId,
      entityLabel: item.title,
      groupId: item.groupId,
      action: 'updated',
      changes: { [field]: { changed: true } },
    },
  ]);
}

/** One folder row (spec §3.1: name, visibility, parent). */
export function folderEntry(
  f: { id: string; groupId: string; name: string },
  action: 'created' | 'updated' | 'deleted',
  changes: AuditEntry['changes'] = {},
): AuditEntry {
  return {
    entityType: 'knowledge_folder',
    entityId: f.id,
    entityLabel: f.name,
    groupId: f.groupId,
    action,
    changes,
  };
}

export function registerKnowledgeAuditResolvers(): void {
  registerAuditResolver('knowledge_item', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: knowledgeItems.id })
        .from(knowledgeItems)
        .where(inArray(knowledgeItems.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  registerAuditResolver('knowledge_folder', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: knowledgeFolders.id })
        .from(knowledgeFolders)
        .where(inArray(knowledgeFolders.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
