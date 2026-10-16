import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  extractMentions,
  isHttpUrl,
  KNOWLEDGE_LIMITS,
  plainExcerpt,
  type FileInfo,
  type KnowledgeChatSource,
  type KnowledgeChatsFilter,
  type KnowledgeDraft,
  type KnowledgeItemDto,
  type KnowledgePage,
  type KnowledgePatch,
  type KnowledgeSummary,
  type KnowledgeType,
  type SessionUser,
  type Visibility,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/index.js';
import { files } from '../files/schema.js';
import {
  attachFiles,
  deleteDetachedFiles,
  detachFiles,
  InvalidAttachmentError,
  setFilesAdminsOnly,
  toFileInfo,
  type FileRow,
} from '../files/service.js';
import { canReadGroup } from '../groups/policy.js';
import { InvalidReminderError } from '../reminders/errors.js';
import {
  getReminderSet,
  pruneRecipientsForAdminsOnly,
  replaceReminderSet,
} from '../reminders/service.js';
import { isAdmin } from '../users/policy.js';
import { groupMembers } from '../groups/schema.js';
import { user } from '../users/schema.js';
import {
  InvalidUrlError,
  InvalidVisibilityError,
  KnowledgeChangedError,
  KnowledgeForbiddenError,
  KnowledgeNotFoundError,
  ValidationError,
} from './errors.js';
import { folderForItem, folderPaths, lockGroupKnowledge } from './folders.js';
import { canEditItem, canReadItem, canSetVisibility } from './policy.js';
import { registerKnowledgeReminderSubject } from './reminder-subject.js';
import { knowledgeAttachments, knowledgeItems } from './schema.js';
import { buildSearchText, escapeLike, searchTerms } from './search.js';
import { clientGroupIds } from '../groups/memberships.js';

// The reminder endpoints and `getReminderSet` resolve items through this adapter.
registerKnowledgeReminderSubject();

export {
  FolderLimitError,
  InvalidFolderError,
  InvalidUrlError,
  InvalidVisibilityError,
  KnowledgeChangedError,
  KnowledgeFolderNotFoundError,
  KnowledgeForbiddenError,
  KnowledgeNotFoundError,
  ValidationError,
} from './errors.js';

const SUBJECT = 'knowledge' as const;

/** A parsed draft; `folderId` may be left out (the top level), as for callers before folders. */
type DraftArg = KnowledgeDraft extends infer D
  ? D extends KnowledgeDraft
    ? Omit<D, 'folderId'> & { folderId?: string | null }
    : never
  : never;

/** The actor's client groups for the policy checks; admins need none. */
const actorGroupOf = (db: Db, actor: SessionUser) =>
  isAdmin(actor) ? Promise.resolve([]) : clientGroupIds(db, actor.id);

// ---------------------------------------------------------------------------------------------
// Page query
// ---------------------------------------------------------------------------------------------

/** One row of the page query (snake case, as Postgres returns it). */
export type PageRow = {
  id: string;
  group_id: string;
  type: KnowledgeType;
  visibility: Visibility;
  title: string;
  url: string | null;
  folder_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  created_text: string;
  body_head: string;
  author_name: string;
  author_role: string;
  group_name: string;
  group_updated: string;
  has_logo: boolean;
  file_count: number;
  first_file: Record<string, unknown> | null;
  next_at: string | null;
  upcoming: number;
  last_at: string | null;
  /** A chat file's source (null for the other types). */
  chat_message_id: string | null;
  chat_file_id: string | null;
  chat_channel_id: string | null;
  chat_kind: KnowledgeChatSource['kind'] | null;
  chat_parent_id: string | null;
  chat_task_id: string | null;
  chat_task_title: string | null;
  chat_ticket_id: string | null;
  chat_ticket_number: number | null;
  /** Only when the full body was asked for (the detail). */
  body?: string;
};

const iso = (expr: SQL) =>
  sql`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The single query of a page (and of the detail): items with author, group, file count and first
 * file (a chat file's own file counts), the reminder aggregate and a chat file's source (its
 * message's thread, its chat, task or ticket: joins by primary key). `limit` rows, newest first.
 */
function pageQuery(where: SQL, limit: number, withBody = false): SQL {
  return sql`
    select k.id, k.group_id, k.type, k.visibility, k.title, k.url, k.folder_id, k.created_by,
           ${iso(sql`k.created_at`)} as created_at, ${iso(sql`k.updated_at`)} as updated_at,
           k.created_at::text as created_text, left(k.body, 2000) as body_head,
           ${withBody ? sql`k.body,` : sql``}
           u.name as author_name, u.role as author_role, g.name as group_name,
           ${iso(sql`g.updated_at`)} as group_updated, g.logo_key is not null as has_logo,
           f.file_count, f.first_file, r.next_at, r.upcoming, r.last_at,
           k.chat_message_id, k.chat_file_id, k.chat_channel_id, k.chat_kind,
           cm.parent_id as chat_parent_id, ch.task_id as chat_task_id,
           ct.title as chat_task_title, ch.ticket_id as chat_ticket_id,
           tk.number as chat_ticket_number
    from knowledge_items k
    join "user" u on u.id = k.created_by
    join groups g on g.id = k.group_id
    left join messages cm on cm.id = k.chat_message_id
    left join channels ch on ch.id = k.chat_channel_id
    left join tasks ct on ct.id = ch.task_id
    left join tickets tk on tk.id = ch.ticket_id
    left join lateral (
      select count(*)::int as file_count,
             (array_agg(to_jsonb(fl) order by fl.created_at, fl.id))[1] as first_file
      from (select a.file_id from knowledge_attachments a where a.item_id = k.id
            union all
            select k.chat_file_id where k.chat_file_id is not null) x
      join files fl on fl.id = x.file_id) f on true
    left join lateral (
      select ${iso(sql`min(t.at) filter (where t.fired_at is null)`)} as next_at,
             (count(*) filter (where t.fired_at is null))::int as upcoming,
             ${iso(sql`max(t.at)`)} as last_at
      from reminder_sets s join reminder_times t on t.set_id = s.id
      where s.knowledge_item_id = k.id) r on true
    where ${where}
    order by k.created_at desc, k.id desc
    limit ${limit}`;
}

/** A `files` row as `to_jsonb` gives it. */
function jsonFileInfo(file: Record<string, unknown>): FileInfo {
  return {
    id: file.id as string,
    name: file.name as string,
    mime: file.mime as string,
    size: file.size as number,
    width: (file.width as number | null) ?? null,
    height: (file.height as number | null) ?? null,
    hasPreview: file.preview_key !== null && file.preview_key !== undefined,
  };
}

type FolderPath = KnowledgeSummary['folderPath'];
type PathOf = (id: string, publicOnly: boolean) => FolderPath;

/** The folder path of a row: a public item's path never shows an admins-only folder. */
const rowPath = (row: PageRow, pathOf: PathOf): FolderPath =>
  row.folder_id === null ? [] : pathOf(row.folder_id, row.visibility === 'public');

/** One query for the folder paths of all these rows. */
const pathsOf = (db: Db, rows: PageRow[]) =>
  folderPaths(
    db,
    rows.flatMap((row) => (row.folder_id === null ? [] : [row.folder_id])),
  );

/** A chat file's source message; null for the other types. */
function chatSource(row: PageRow): KnowledgeChatSource | null {
  if (row.chat_message_id === null || row.chat_channel_id === null || row.chat_kind === null) {
    return null;
  }
  return {
    channelId: row.chat_channel_id,
    messageId: row.chat_message_id,
    parentId: row.chat_parent_id,
    kind: row.chat_kind,
    taskId: row.chat_task_id,
    taskTitle: row.chat_task_title,
    ticketId: row.chat_ticket_id,
    ticketNumber: row.chat_ticket_number,
  };
}

/** A list row; `names` resolves the mentions of the excerpt, `folderPath` is the row's path. */
export function toSummary(
  row: PageRow,
  names: Map<string, string>,
  folderPath: FolderPath = [],
): KnowledgeSummary {
  return {
    id: row.id,
    groupId: row.group_id,
    type: row.type,
    visibility: row.visibility,
    title: row.title,
    excerpt: plainExcerpt(row.body_head, (id) => names.get(id), KNOWLEDGE_LIMITS.excerpt),
    url: row.url,
    file:
      (row.type === 'file' || row.type === 'chat_file') && row.first_file
        ? jsonFileInfo(row.first_file)
        : null,
    fileCount: row.file_count ?? 0,
    nextReminderAt: row.next_at,
    upcomingCount: row.upcoming ?? 0,
    lastReminderAt: row.last_at,
    createdBy: { id: row.created_by, name: row.author_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    folderId: row.folder_id,
    folderPath,
    chat: chatSource(row),
  };
}

const withGroup = (row: PageRow, summary: KnowledgeSummary): KnowledgeSummary => ({
  ...summary,
  group: {
    id: row.group_id,
    name: row.group_name,
    logoUrl: row.has_logo
      ? `/api/groups/${encodeURIComponent(row.group_id)}/logo?v=${encodeURIComponent(row.group_updated)}`
      : null,
  },
});

/**
 * The names of the users mentioned in the bodies, per group: only people of that group (its
 * members and admins), so a body never reveals the name of someone outside the item's group.
 * One query for any number of items.
 */
async function mentionNames(
  db: Db,
  entries: { groupId: string; body: string }[],
): Promise<Map<string, Map<string, string>>> {
  const byGroup = new Map<string, Map<string, string>>();
  for (const entry of entries) byGroup.set(entry.groupId, new Map());
  const ids = [...new Set(entries.flatMap((e) => extractMentions(e.body).userIds))];
  if (ids.length === 0) return byGroup;
  const rows = await db
    .select({ id: user.id, name: user.name, role: user.role, groupId: groupMembers.groupId })
    .from(user)
    .leftJoin(
      groupMembers,
      and(
        eq(groupMembers.userId, user.id),
        eq(groupMembers.role, 'client'),
        isNull(groupMembers.removedAt),
      ),
    )
    .where(inArray(user.id, ids));
  for (const row of rows) {
    for (const [groupId, names] of byGroup) {
      if (row.role !== 'client' || row.groupId === groupId) names.set(row.id, row.name);
    }
  }
  return byGroup;
}

const namesIn = (names: Map<string, Map<string, string>>, groupId: string) =>
  names.get(groupId) ?? new Map<string, string>();

const CURSOR_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/;

function encodeCursor(row: PageRow): string {
  return Buffer.from(`${row.created_text}|${row.id}`).toString('base64url');
}

/** The cursor carries Postgres's own text of `created_at`, so no microseconds are lost. */
function cursorWhere(cursor: string): SQL {
  const text = Buffer.from(cursor, 'base64url').toString();
  const at = text.indexOf('|');
  const createdText = text.slice(0, at);
  const id = text.slice(at + 1);
  if (at < 0 || !CURSOR_TEXT.test(createdText) || id.length === 0 || id.length > 100) {
    throw new ValidationError('Invalid cursor');
  }
  return sql`(k.created_at, k.id) < (${createdText}::timestamptz, ${id})`;
}

/**
 * `types`: any of these types; empty or absent means every type. `folder`: the items directly in
 * that folder, null the top level; absent means every folder (the flat list of a search). Chat
 * files are in no folder: a folder view never lists them. `chats`: `all` lists the files of
 * every chat, otherwise (the default) only the group chat's.
 */
type ListFilters = {
  types?: KnowledgeType[];
  q?: string;
  cursor?: string;
  folder?: string | null;
  chats?: KnowledgeChatsFilter;
};

function filterWhere(scope: SQL, opts: ListFilters): SQL {
  const parts: SQL[] = [scope];
  const types = [...new Set(opts.types ?? [])];
  // A filter on top of the (group, created) and (created) indexes, as one type was before.
  if (types.length > 0) {
    parts.push(
      sql`k.type in (${sql.join(
        types.map((type) => sql`${type}`),
        sql`, `,
      )})`,
    );
  }
  for (const term of searchTerms(opts.q ?? '')) {
    parts.push(sql`k.search_text ilike '%' || ${escapeLike(term)} || '%' escape '\\'`);
  }
  if (opts.folder === null) parts.push(sql`k.folder_id is null and k.type <> 'chat_file'`);
  else if (opts.folder !== undefined) parts.push(sql`k.folder_id = ${opts.folder}`);
  if (opts.chats !== 'all') parts.push(sql`(k.type <> 'chat_file' or k.chat_kind = 'group')`);
  if (opts.cursor) parts.push(cursorWhere(opts.cursor));
  return sql.join(parts, sql` and `);
}

async function runPage(
  db: Db,
  where: SQL,
  decorate: (row: PageRow, summary: KnowledgeSummary) => KnowledgeSummary = (_, s) => s,
): Promise<KnowledgePage> {
  const size = KNOWLEDGE_LIMITS.pageSize;
  const rows = [...(await db.execute<PageRow>(pageQuery(where, size + 1)))];
  const page = rows.slice(0, size);
  const [names, pathOf] = await Promise.all([
    mentionNames(
      db,
      page.map((row) => ({ groupId: row.group_id, body: row.body_head })),
    ),
    pathsOf(db, page),
  ]);
  return {
    items: page.map((row) =>
      decorate(row, toSummary(row, namesIn(names, row.group_id), rowPath(row, pathOf))),
    ),
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/** The tab's page, newest first. Clients get public items only. */
export async function listGroupItems(
  db: Db,
  actor: SessionUser,
  groupId: string,
  opts: ListFilters,
): Promise<KnowledgePage> {
  if (!canReadGroup(actor, groupId, await actorGroupOf(db, actor))) {
    throw new KnowledgeNotFoundError();
  }
  // A folder the actor cannot see is "not found", like an unknown id.
  if (typeof opts.folder === 'string') await folderForItem(db, actor, groupId, opts.folder);
  const scope = isAdmin(actor)
    ? sql`k.group_id = ${groupId}`
    : sql`k.group_id = ${groupId} and k.visibility = 'public'`;
  return runPage(db, filterWhere(scope, opts));
}

/**
 * The global list for admins (the route requires an admin): `groupIds` null means every group.
 * Each summary carries its `group`.
 */
export async function listAllItems(
  db: Db,
  opts: ListFilters & { groupIds: string[] | null },
): Promise<KnowledgePage> {
  let scope: SQL;
  if (opts.groupIds === null) scope = sql`true`;
  else if (opts.groupIds.length === 0) return { items: [], nextCursor: null };
  else scope = sql`k.group_id in (${sql.join([...new Set(opts.groupIds)], sql`, `)})`;
  return runPage(db, filterWhere(scope, opts), withGroup);
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** What the routes need to check access and route events, or null. */
export async function getItemRef(
  db: Db,
  id: string,
): Promise<{
  id: string;
  groupId: string;
  visibility: Visibility;
  createdBy: string;
  authorIsClient: boolean;
} | null> {
  const rows = await db.execute<{
    id: string;
    group_id: string;
    visibility: Visibility;
    created_by: string;
    author_role: string;
  }>(sql`select k.id, k.group_id, k.visibility, k.created_by, u.role as author_role
         from knowledge_items k join "user" u on u.id = k.created_by where k.id = ${id}`);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    groupId: row.group_id,
    visibility: row.visibility,
    createdBy: row.created_by,
    authorIsClient: row.author_role === 'client',
  };
}

async function itemFiles(db: Db, id: string, chatFileId: string | null): Promise<FileRow[]> {
  if (chatFileId !== null) return db.select().from(files).where(eq(files.id, chatFileId));
  return db
    .select({ file: files })
    .from(knowledgeAttachments)
    .innerJoin(files, eq(files.id, knowledgeAttachments.fileId))
    .where(eq(knowledgeAttachments.itemId, id))
    .orderBy(files.createdAt, files.id)
    .then((rows) => rows.map((r) => r.file));
}

/** The detail of a readable item; an unknown or unreadable one is KnowledgeNotFoundError. */
export async function getItem(db: Db, actor: SessionUser, id: string): Promise<KnowledgeItemDto> {
  const [rows, actorGroupIds] = await Promise.all([
    db.execute<PageRow>(pageQuery(sql`k.id = ${id}`, 1, true)),
    actorGroupOf(db, actor),
  ]);
  const row = rows[0];
  if (!row) throw new KnowledgeNotFoundError();
  const item = {
    groupId: row.group_id,
    visibility: row.visibility,
    createdBy: row.created_by,
    type: row.type,
  };
  if (!canReadItem(actor, item, actorGroupIds)) throw new KnowledgeNotFoundError();
  const body = row.body ?? '';
  const [names, fileRows, reminder, pathOf] = await Promise.all([
    mentionNames(db, [{ groupId: row.group_id, body }]),
    itemFiles(db, id, row.chat_file_id),
    row.type === 'reminder' ? getReminderSet(db, { kind: SUBJECT, id }, actor) : null,
    pathsOf(db, [row]),
  ]);
  return {
    ...toSummary(row, namesIn(names, row.group_id), rowPath(row, pathOf)),
    body,
    files: fileRows.map(toFileInfo),
    reminder,
    canEdit: canEditItem(actor, item, actorGroupIds),
    visibilityLocked: row.author_role === 'client',
  };
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

async function computeSearchText(
  tx: Db,
  input: { groupId: string; title: string; body: string; url: string | null; fileIds: string[] },
): Promise<string> {
  const [byGroup, fileNames] = await Promise.all([
    mentionNames(tx, [{ groupId: input.groupId, body: input.body }]),
    input.fileIds.length === 0
      ? Promise.resolve([] as { name: string }[])
      : tx.select({ name: files.name }).from(files).where(inArray(files.id, input.fileIds)),
  ]);
  return buildSearchText({
    title: input.title,
    body: input.body,
    url: input.url,
    fileNames: fileNames.map((f) => f.name),
    nameOf: (id) => namesIn(byGroup, input.groupId).get(id),
  });
}

/**
 * Inserts an item with its files and reminder inside `tx` (no access check; `createItem` and
 * tests call it). Returns the new id and its file ids.
 */
export async function insertItem(
  tx: Db,
  actor: SessionUser,
  groupId: string,
  draft: DraftArg,
): Promise<{ id: string; fileIds: string[] }> {
  const id = randomUUID();
  const fileIds = [...new Set(draft.fileIds)];
  const url = draft.type === 'link' ? draft.url : null;
  await attachFiles(tx, groupId, fileIds, actor.id);
  const searchText = await computeSearchText(tx, {
    groupId,
    title: draft.title,
    body: draft.body,
    url,
    fileIds,
  });
  await tx.insert(knowledgeItems).values({
    id,
    groupId,
    type: draft.type,
    visibility: draft.visibility,
    title: draft.title,
    body: draft.body,
    url,
    folderId: draft.folderId ?? null,
    createdBy: actor.id,
    searchText,
  });
  if (fileIds.length > 0) {
    await tx.insert(knowledgeAttachments).values(fileIds.map((fileId) => ({ itemId: id, fileId })));
    // Always set: a reused upload may still carry the flag from an earlier admins-only item.
    await setFilesAdminsOnly(tx, fileIds, draft.visibility === 'admins');
  }
  if (draft.type === 'reminder') {
    await replaceReminderSet(
      tx,
      {
        kind: SUBJECT,
        id,
        groupId,
        adminsOnly: draft.visibility === 'admins',
        authorId: actor.id,
      },
      draft.reminder,
      actor,
    );
  }
  return { id, fileIds };
}

/** Per-type file count: a file item exactly one, a note up to 10, links and reminders none. */
function checkFileCount(type: KnowledgeType, count: number): void {
  const ok =
    type === 'file'
      ? count === 1
      : type === 'note'
        ? count <= KNOWLEDGE_LIMITS.noteFiles
        : count === 0;
  if (!ok) throw new InvalidAttachmentError();
}

/** Creates an item in one transaction. A client cannot create an admins-only item. */
export async function createItem(
  deps: { db: Db },
  actor: SessionUser,
  groupId: string,
  draft: DraftArg,
): Promise<{ item: KnowledgeItemDto; fileIds: string[] }> {
  const { db } = deps;
  if (!canReadGroup(actor, groupId, await actorGroupOf(db, actor))) {
    throw new KnowledgeNotFoundError();
  }
  if (!canSetVisibility(actor, null, draft.visibility)) throw new InvalidVisibilityError();
  if (draft.type === 'link' && !isHttpUrl(draft.url)) throw new InvalidUrlError();
  checkFileCount(draft.type, new Set(draft.fileIds).size);
  const { id, fileIds } = await db.transaction(async (tx) => {
    await lockGroupKnowledge(tx, groupId);
    const folder = await folderForItem(tx, actor, groupId, draft.folderId ?? null);
    // Inside an admins-only folder everything is admins-only (only admins see such a folder).
    const visibility = folder?.visibility === 'admins' ? 'admins' : draft.visibility;
    return insertItem(tx, actor, groupId, { ...draft, visibility });
  });
  return { item: await getItem(db, actor, id), fileIds };
}

type LockedRow = {
  id: string;
  group_id: string;
  type: KnowledgeType;
  visibility: Visibility;
  title: string;
  body: string;
  url: string | null;
  folder_id: string | null;
  created_by: string;
  updated_at: string;
  author_role: string;
};

/** Locks the item row and checks that the actor may change it. */
async function lockForWrite(tx: Db, actor: SessionUser, id: string): Promise<LockedRow> {
  const rows = await tx.execute<LockedRow>(sql`
    select k.id, k.group_id, k.type, k.visibility, k.title, k.body, k.url, k.folder_id,
           k.created_by, ${iso(sql`k.updated_at`)} as updated_at, u.role as author_role
    from knowledge_items k join "user" u on u.id = k.created_by
    where k.id = ${id} for update of k`);
  const row = rows[0];
  if (!row) throw new KnowledgeNotFoundError();
  const actorGroupIds = await actorGroupOf(tx, actor);
  const item = {
    groupId: row.group_id,
    visibility: row.visibility,
    createdBy: row.created_by,
    type: row.type,
  };
  if (!canReadItem(actor, item, actorGroupIds)) throw new KnowledgeNotFoundError();
  if (!canEditItem(actor, item, actorGroupIds)) throw new KnowledgeForbiddenError();
  return row;
}

/**
 * Edits an item in one transaction: the stale check, per-type rules, files, visibility (files
 * follow it, non-admin recipients are dropped on a switch to admins), the reminder and
 * `search_text`. The caller deletes `removedFileIds` after the commit (`deleteDetachedFiles`).
 */
export async function updateItem(
  deps: { db: Db },
  actor: SessionUser,
  id: string,
  patch: KnowledgePatch,
): Promise<{ item: KnowledgeItemDto; previousVisibility: Visibility; removedFileIds: string[] }> {
  const { db } = deps;
  if ('type' in patch) throw new ValidationError('The type cannot change');
  const ref = await getItemRef(db, id);
  if (!ref) throw new KnowledgeNotFoundError();
  const result = await db.transaction(async (tx) => {
    // The group's lock first, then the row: the order of a folder's cascade too.
    await lockGroupKnowledge(tx, ref.groupId);
    const row = await lockForWrite(tx, actor, id);
    if (row.updated_at !== new Date(patch.updatedAt).toISOString()) {
      throw new KnowledgeChangedError();
    }
    const folderId = patch.folderId !== undefined ? patch.folderId : row.folder_id;
    const folder = await folderForItem(tx, actor, row.group_id, folderId);
    // Inside an admins-only folder the item is admins-only (moved there, it becomes so).
    const inAdmins = folder?.visibility === 'admins';
    if (inAdmins && patch.visibility === 'public') throw new InvalidVisibilityError();
    const visibility: Visibility = inAdmins ? 'admins' : (patch.visibility ?? row.visibility);
    if (
      visibility !== row.visibility &&
      !canSetVisibility(actor, { authorIsClient: row.author_role === 'client' }, visibility)
    ) {
      throw new InvalidVisibilityError();
    }
    let url = row.url;
    if (patch.url !== undefined) {
      if (row.type !== 'link' || !isHttpUrl(patch.url)) throw new InvalidUrlError();
      url = patch.url;
    }
    if (patch.reminder !== undefined && row.type !== 'reminder') throw new InvalidReminderError();

    const current = (
      await tx
        .select({ fileId: knowledgeAttachments.fileId })
        .from(knowledgeAttachments)
        .where(eq(knowledgeAttachments.itemId, id))
    ).map((r) => r.fileId);
    const next = patch.fileIds ? [...new Set(patch.fileIds)] : current;
    checkFileCount(row.type, next.length);
    const added = next.filter((fileId) => !current.includes(fileId));
    const removed = current.filter((fileId) => !next.includes(fileId));
    if (added.length > 0) {
      await attachFiles(tx, row.group_id, added, actor.id);
      await tx.insert(knowledgeAttachments).values(added.map((fileId) => ({ itemId: id, fileId })));
    }
    if (removed.length > 0) {
      await tx
        .delete(knowledgeAttachments)
        .where(
          and(eq(knowledgeAttachments.itemId, id), inArray(knowledgeAttachments.fileId, removed)),
        );
      await detachFiles(tx, removed);
    }
    if (visibility !== row.visibility) {
      await setFilesAdminsOnly(tx, next, visibility === 'admins');
    } else if (added.length > 0) {
      await setFilesAdminsOnly(tx, added, visibility === 'admins');
    }

    if (patch.reminder !== undefined) {
      await replaceReminderSet(
        tx,
        {
          kind: SUBJECT,
          id,
          groupId: row.group_id,
          adminsOnly: visibility === 'admins',
          authorId: row.created_by,
        },
        patch.reminder,
        actor,
      );
    }
    if (visibility === 'admins' && row.visibility !== 'admins') {
      await pruneRecipientsForAdminsOnly(tx, { kind: SUBJECT, id });
    }

    const title = patch.title ?? row.title;
    const body = patch.body ?? row.body;
    const searchText = await computeSearchText(tx, {
      groupId: row.group_id,
      title,
      body,
      url,
      fileIds: next,
    });
    await tx
      .update(knowledgeItems)
      .set({ title, body, url, visibility, folderId, searchText, updatedAt: sql`now()` })
      .where(eq(knowledgeItems.id, id));
    return { previousVisibility: row.visibility, removedFileIds: removed };
  });
  return { item: await getItem(db, actor, id), ...result };
}

/**
 * Deletes an item: its files are detached in the transaction and deleted after the commit; the
 * attachments and reminder rows cascade.
 */
export async function deleteItem(
  deps: { db: Db; storage: Storage },
  actor: SessionUser,
  id: string,
): Promise<{ groupId: string; visibility: Visibility }> {
  const { db, storage } = deps;
  const { row, fileIds } = await db.transaction(async (tx) => {
    const row = await lockForWrite(tx, actor, id);
    const fileIds = (
      await tx
        .select({ fileId: knowledgeAttachments.fileId })
        .from(knowledgeAttachments)
        .where(eq(knowledgeAttachments.itemId, id))
    ).map((r) => r.fileId);
    await detachFiles(tx, fileIds);
    await tx.delete(knowledgeItems).where(eq(knowledgeItems.id, id));
    return { row, fileIds };
  });
  // A failure here leaves detached files, which the daily unattached cleanup removes.
  await deleteDetachedFiles({ db, storage }, fileIds).catch(() => undefined);
  return { groupId: row.group_id, visibility: row.visibility };
}

// ---------------------------------------------------------------------------------------------
// Chat files
// ---------------------------------------------------------------------------------------------

/** The "From chat" items of one message, as list rows (for the live event after a send). */
export async function chatFileSummaries(db: Db, messageId: string): Promise<KnowledgeSummary[]> {
  const rows = [
    ...(await db.execute<PageRow>(
      pageQuery(sql`k.chat_message_id = ${messageId}`, KNOWLEDGE_LIMITS.pageSize),
    )),
  ];
  return rows.map((row) => toSummary(row, new Map()));
}
