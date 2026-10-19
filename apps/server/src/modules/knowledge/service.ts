import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  extractMentions,
  isHttpUrl,
  KNOWLEDGE_LIMITS,
  knowledgeExcerpt,
  type FileInfo,
  type KnowledgeChatSource,
  type KnowledgeChatsFilter,
  type KnowledgeDraft,
  type KnowledgeItemDto,
  type KnowledgePage,
  type KnowledgePatch,
  type KnowledgeSummary,
  type KnowledgeToFile,
  type KnowledgeType,
  type MeetingListInfo,
  type MeetingPatch,
  type MeetingSeriesScope,
  type SessionUser,
  type Visibility,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import type { Storage } from '../../infra/storage/index.js';
import { files } from '../files/schema.js';
import {
  attachFiles,
  copyFile,
  deleteDetachedFiles,
  detachFiles,
  InvalidAttachmentError,
  setFilesAdminsOnly,
  toFileInfo,
  type FileRow,
} from '../files/service.js';
import { adminGroupId } from '../groups/admin-group.js';
import { canReadGroup } from '../groups/policy.js';
import { InvalidReminderError } from '../reminders/errors.js';
import { canUseBoard } from '../tasks/policy.js';
import { listTasksFromMeeting } from '../tasks/task-service.js';
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
import { folderChains, folderForItem, folderPaths, lockGroupKnowledge } from './folders.js';
import { linkedCardsOf, setLinkedItems } from './links.js';
import { recordMeetingScheduled } from './meeting-notify.js';
import {
  checkRepeat,
  createSeries,
  dropEmptySeries,
  endSeriesAt,
  seriesInfo,
  seriesPlaceOf,
  updateFollowing,
} from './meeting-series.js';
import { recordDescriptionMentions } from '../notifications/description-mentions.js';
import { requestDelivery } from '../notifications/service.js';
import {
  canConvertChatFile,
  canEditItem,
  canReadItem,
  canSetVisibility,
  isShareableInto,
} from './policy.js';
import { registerKnowledgeReminderSubject } from './reminder-subject.js';
import { knowledgeAttachments, knowledgeItems } from './schema.js';
import { buildSearchText, escapeLike, searchTerms } from '../../infra/text/search.js';
import {
  getMeetingRow,
  insertMeeting,
  meetingSearchExtras,
  patchMeeting,
  toMeetingDetail,
} from './meeting-store.js';
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
// "Navrhnúť odpoveď" (2026-10-19): the knowledge an AI ticket draft may use.
export { draftKnowledge, type DraftKnowledgeItem } from './draft-sources.js';

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
type PageRow = {
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
  /** `admin` for the admin group (Phase 34). */
  group_kind?: string;
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
  /** A meeting's date and states (null for the other types). */
  m_starts_at: string | null;
  m_recording_state: MeetingListInfo['recording'] | null;
  m_ai_state: MeetingListInfo['ai'] | null;
  m_has_summary: boolean | null;
  /** The meeting's transcript and summary are held for admins (Teams T1). */
  m_admins_only: boolean | null;
  /** The meeting is one call of a recurring series (ADR 0049). */
  m_recurring: boolean | null;
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
           g.kind as group_kind,
           ${iso(sql`g.updated_at`)} as group_updated, g.logo_key is not null as has_logo,
           f.file_count, f.first_file, r.next_at, r.upcoming, r.last_at,
           k.chat_message_id, k.chat_file_id, k.chat_channel_id, k.chat_kind,
           cm.parent_id as chat_parent_id, ch.task_id as chat_task_id,
           ct.title as chat_task_title, ch.ticket_id as chat_ticket_id,
           tk.number as chat_ticket_number,
           ${iso(sql`m.starts_at`)} as m_starts_at, m.recording_state as m_recording_state,
           m.ai_state as m_ai_state, m.summary is not null as m_has_summary,
           m.transcript_admins_only as m_admins_only, m.series_id is not null as m_recurring
    from knowledge_items k
    join "user" u on u.id = k.created_by
    join groups g on g.id = k.group_id
    left join messages cm on cm.id = k.chat_message_id
    left join channels ch on ch.id = k.chat_channel_id
    left join tasks ct on ct.id = ch.task_id
    left join tickets tk on tk.id = ch.ticket_id
    left join knowledge_meetings m on m.item_id = k.id
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

/**
 * A list row; `names` resolves the mentions of the excerpt, `folderPath` is the row's path.
 * `viewerIsAdmin`: a summary held for admins (Teams T1) shows no badge to anyone else.
 */
function toSummary(
  row: PageRow,
  names: Map<string, string>,
  folderPath: FolderPath = [],
  viewerIsAdmin = false,
): KnowledgeSummary {
  return {
    id: row.id,
    groupId: row.group_id,
    type: row.type,
    visibility: row.visibility,
    title: row.title,
    excerpt: knowledgeExcerpt(row.body_head, (id) => names.get(id), KNOWLEDGE_LIMITS.excerpt),
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
    meeting: meetingInfo(row, viewerIsAdmin),
    ...(row.group_kind === 'admin' ? { source: 'admin_group' as const } : {}),
  };
}

/** A meeting's list info; null for the other types. */
function meetingInfo(row: PageRow, viewerIsAdmin: boolean): MeetingListInfo | null {
  if (row.type !== 'meeting' || row.m_starts_at === null) return null;
  return {
    startsAt: row.m_starts_at,
    recording: row.m_recording_state ?? 'none',
    ai: row.m_ai_state ?? 'idle',
    hasSummary: row.m_has_summary === true && (viewerIsAdmin || row.m_admins_only !== true),
    recurring: row.m_recurring === true,
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
export async function mentionNames(
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
  /**
   * Phase 28: only items that may be attached to a chat message (public; an item inside an
   * admins-only folder is admins-only itself, so the folders need no check here).
   */
  shareable?: boolean;
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
  if (opts.shareable) parts.push(sql`k.visibility = 'public'`);
  if (opts.cursor) parts.push(cursorWhere(opts.cursor));
  return sql.join(parts, sql` and `);
}

async function runPage(
  db: Db,
  where: SQL,
  viewerIsAdmin: boolean,
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
      decorate(
        row,
        toSummary(row, namesIn(names, row.group_id), rowPath(row, pathOf), viewerIsAdmin),
      ),
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
  return runPage(db, filterWhere(scope, opts), isAdmin(actor));
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
  return runPage(db, filterWhere(scope, opts), true, withGroup);
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** What the routes need of an item to check access and route events. */
export type ItemRef = {
  id: string;
  groupId: string;
  visibility: Visibility;
  createdBy: string;
  authorIsClient: boolean;
};

/** What the routes need to check access and route events, or null. */
export async function getItemRef(db: Db, id: string): Promise<ItemRef | null> {
  return (await getItemRefs(db, [id])).get(id) ?? null;
}

/** Whether the item exists and the actor reads it (`canReadItem`). */
export async function canReadItemById(db: Db, actor: SessionUser, id: string): Promise<boolean> {
  const [ref, actorGroupIds] = await Promise.all([getItemRef(db, id), actorGroupOf(db, actor)]);
  return ref !== null && canReadItem(actor, ref, actorGroupIds);
}

/** `getItemRef` of each of these items that exists, by id, in one query (2026-10-18). */
export async function getItemRefs(db: Db, ids: string[]): Promise<Map<string, ItemRef>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{
    id: string;
    group_id: string;
    visibility: Visibility;
    created_by: string;
    author_role: string;
  }>(sql`select k.id, k.group_id, k.visibility, k.created_by, u.role as author_role
         from knowledge_items k join "user" u on u.id = k.created_by
         where k.id in (${sql.join(
           [...new Set(ids)].map((id) => sql`${id}`),
           sql`, `,
         )})`);
  return new Map(
    [...rows].map((row) => [
      row.id,
      {
        id: row.id,
        groupId: row.group_id,
        visibility: row.visibility,
        createdBy: row.created_by,
        authorIsClient: row.author_role === 'client',
      },
    ]),
  );
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
  const hasReminder = row.type === 'reminder' || row.type === 'meeting';
  const isMeeting = row.type === 'meeting';
  // Whoever reads the item reads its group's board (admins and its clients): the meeting's tasks.
  const [names, fileRows, reminder, pathOf, meeting, meetingTasks, linked] = await Promise.all([
    mentionNames(db, [{ groupId: row.group_id, body }]),
    itemFiles(db, id, row.chat_file_id),
    hasReminder ? getReminderSet(db, { kind: SUBJECT, id }, actor) : null,
    pathsOf(db, [row]),
    isMeeting ? getMeetingRow(db, id) : null,
    isMeeting && canUseBoard(actor, row.group_id, actorGroupIds)
      ? listTasksFromMeeting(db, id)
      : [],
    linkedCardsOf(db, 'knowledge', id, row.group_id),
  ]);
  const fileInfos = fileRows.map(toFileInfo);
  const series =
    meeting?.seriesId != null && meeting.seriesIndex !== null
      ? await seriesInfo(
          db,
          { seriesId: meeting.seriesId, index: meeting.seriesIndex },
          isAdmin(actor),
        )
      : null;
  return {
    linkedKnowledge: linked,
    ...toSummary(row, namesIn(names, row.group_id), rowPath(row, pathOf), isAdmin(actor)),
    body,
    files: fileInfos,
    reminder,
    canEdit: canEditItem(actor, item, actorGroupIds),
    canConvert: canConvertChatFile(actor, item, actorGroupIds),
    visibilityLocked: row.author_role === 'client',
    meetingDetail: meeting
      ? toMeetingDetail(
          meeting,
          fileInfos.find((f) => f.id === meeting.recordingFileId) ?? null,
          meetingTasks,
          isAdmin(actor),
          series,
        )
      : null,
  };
}

/**
 * Phase 28: the read-only detail of an item for a reader who reaches it through a place of
 * `groupId` (a message, or a description in Phase 33): a ziadatel in a ticket chat, or (Phase
 * 34) a client opening an admin-group item shared with their group. The caller checked the
 * place; here the item must still be shareable there (`isShareableInto`), else null. No
 * reminders, no link to a chat the reader may not open, never editable; an item of another
 * group (the admin group's) shows no folders.
 */
export async function getSharedItem(
  db: Db,
  id: string,
  groupId: string,
): Promise<KnowledgeItemDto | null> {
  const [[row], adminId] = await Promise.all([
    db.execute<PageRow>(pageQuery(sql`k.id = ${id}`, 1, true)),
    adminGroupId(db),
  ]);
  if (!row) return null;
  const chainOf = await folderChains(db, row.folder_id === null ? [] : [row.folder_id]);
  const fromElsewhere = row.group_id !== groupId;
  const chain = row.folder_id === null ? [] : chainOf(row.folder_id);
  const item = { groupId: row.group_id, visibility: row.visibility, type: row.type };
  if (
    !isShareableInto(
      item,
      chain.map((f) => f.visibility),
      groupId,
      adminId,
    )
  )
    return null;
  const body = row.body ?? '';
  const [names, fileRows, meeting] = await Promise.all([
    mentionNames(db, [{ groupId: row.group_id, body }]),
    itemFiles(db, id, row.chat_file_id),
    row.type === 'meeting' ? getMeetingRow(db, id) : null,
  ]);
  const fileInfos = fileRows.map(toFileInfo);
  const folderPath = fromElsewhere ? [] : chain.map((f) => ({ id: f.id, name: f.name }));
  return {
    ...toSummary(row, namesIn(names, row.group_id), folderPath),
    ...(fromElsewhere ? { folderId: null } : {}),
    chat: null,
    body,
    files: fileInfos,
    reminder: null,
    canEdit: false,
    visibilityLocked: true,
    // A reader through a chat message (a ziadatel) never uses the board: no task links.
    meetingDetail: meeting
      ? toMeetingDetail(
          meeting,
          fileInfos.find((f) => f.id === meeting.recordingFileId) ?? null,
          [],
          // Its readers are clients and ziadatels (or admins in the admin group): a transcript
          // held for admins stays hidden here.
          false,
        )
      : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

async function computeSearchText(
  tx: Db,
  input: {
    groupId: string;
    title: string;
    body: string;
    url: string | null;
    fileIds: string[];
    extra?: string[];
  },
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
    extra: input.extra,
  });
}

/**
 * Writes `search_text` again from the item as stored (a meeting's job changed its summary or its
 * recording). No access check.
 */
export async function refreshSearchText(db: Db, id: string): Promise<void> {
  const [item] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id));
  if (!item) return;
  const [fileIds, meeting] = await Promise.all([
    db
      .select({ fileId: knowledgeAttachments.fileId })
      .from(knowledgeAttachments)
      .where(eq(knowledgeAttachments.itemId, id))
      .then((rows) => rows.map((r) => r.fileId)),
    item.type === 'meeting' ? getMeetingRow(db, id) : null,
  ]);
  const searchText = await computeSearchText(db, {
    groupId: item.groupId,
    title: item.title,
    body: item.body,
    url: item.url,
    fileIds,
    extra: meeting ? meetingSearchExtras(meeting) : [],
  });
  await db.update(knowledgeItems).set({ searchText }).where(eq(knowledgeItems.id, id));
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
    extra:
      draft.type === 'meeting'
        ? meetingSearchExtras({ ...draft.meeting, summary: null, transcriptAdminsOnly: false })
        : [],
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
  if (draft.type === 'meeting') await insertMeeting(tx, id, draft.meeting);
  const reminderInput =
    draft.type === 'reminder' || draft.type === 'meeting' ? draft.reminder : undefined;
  if (reminderInput && reminderInput.times.length > 0) {
    await replaceReminderSet(
      tx,
      {
        kind: SUBJECT,
        id,
        groupId,
        adminsOnly: draft.visibility === 'admins',
        authorId: actor.id,
      },
      reminderInput,
      actor,
    );
  }
  return { id, fileIds };
}

/**
 * Per-type file count: a file item exactly one, a note up to 10, links and reminders none, a
 * meeting at most its stored recording (attached by the transcoder, never by a draft).
 */
function checkFileCount(type: KnowledgeType, count: number): void {
  const ok =
    type === 'file'
      ? count === 1
      : type === 'note'
        ? count <= KNOWLEDGE_LIMITS.noteFiles
        : type === 'meeting'
          ? count <= 1
          : count === 0;
  if (!ok) throw new InvalidAttachmentError();
}

/**
 * Creates an item in one transaction. A client cannot create an admins-only item. A meeting with
 * a start in the future records `meeting.scheduled` in the same transaction; with `jobs` its
 * delivery is requested after the commit (otherwise the one-minute sweep delivers it).
 */
export async function createItem(
  deps: { db: Db; jobs?: JobQueue },
  actor: SessionUser,
  groupId: string,
  draft: DraftArg,
): Promise<{ item: KnowledgeItemDto; fileIds: string[]; seriesItemIds: string[] }> {
  const { db } = deps;
  if (!canReadGroup(actor, groupId, await actorGroupOf(db, actor))) {
    throw new KnowledgeNotFoundError();
  }
  if (!canSetVisibility(actor, null, draft.visibility)) throw new InvalidVisibilityError();
  if (draft.type === 'link' && !isHttpUrl(draft.url)) throw new InvalidUrlError();
  checkFileCount(draft.type, new Set(draft.fileIds).size);
  // ADR 0049: a repeating call; whoever may create the call may make it repeat.
  const repeat = draft.type === 'meeting' ? (draft.meeting.repeat ?? null) : null;
  if (draft.type === 'meeting' && repeat) checkRepeat(repeat, new Date(draft.meeting.startsAt));
  const { id, fileIds, eventIds, seriesItemIds } = await db.transaction(async (tx) => {
    await lockGroupKnowledge(tx, groupId);
    const folder = await folderForItem(tx, actor, groupId, draft.folderId ?? null);
    // Inside an admins-only folder everything is admins-only (only admins see such a folder).
    const visibility = folder?.visibility === 'admins' ? 'admins' : draft.visibility;
    const inserted = await insertItem(tx, actor, groupId, { ...draft, visibility });
    if (draft.knowledgeIds) {
      await setLinkedItems(tx, { kind: 'knowledge', id: inserted.id }, groupId, draft.knowledgeIds);
    }
    const seriesItemIds =
      draft.type === 'meeting' && repeat
        ? await createSeries(tx, {
            groupId,
            firstItemId: inserted.id,
            firstStart: new Date(draft.meeting.startsAt),
            repeat,
            template: {
              title: draft.title,
              body: draft.body,
              visibility,
              folderId: draft.folderId ?? null,
              meetingUrl: draft.meeting.meetingUrl,
              reminderTimes: draft.reminder?.times ?? [],
              reminderRecipientIds: draft.reminder?.recipientIds ?? [],
            },
            authorId: actor.id,
          })
        : [];
    // One notification for a new series: its first call's (the later calls are silent).
    const eventIds =
      draft.type === 'meeting'
        ? await recordMeetingScheduled(
            tx,
            'meeting.scheduled',
            {
              itemId: inserted.id,
              groupId,
              title: draft.title,
              startsAt: new Date(draft.meeting.startsAt),
              adminsOnly: visibility === 'admins',
            },
            actor.id,
          )
        : [];
    const mentions = await recordDescriptionMentions(tx, {
      actor,
      groupId,
      subject: {
        kind: 'knowledge',
        id: inserted.id,
        title: draft.title,
        adminsOnly: visibility === 'admins',
      },
      before: null,
      after: draft.body,
    });
    return { ...inserted, seriesItemIds, eventIds: [...eventIds, ...mentions] };
  });
  if (deps.jobs) await requestDelivery(deps.jobs, eventIds);
  return { item: await getItem(db, actor, id), fileIds, seriesItemIds };
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

/**
 * Locks the item row and checks that the actor may change it (`canEditItem`, or `may` for a
 * write of its own, such as turning a chat file into a file item).
 */
async function lockForWrite(
  tx: Db,
  actor: SessionUser,
  id: string,
  may: typeof canEditItem = canEditItem,
): Promise<LockedRow> {
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
  if (!may(actor, item, actorGroupIds)) throw new KnowledgeForbiddenError();
  return row;
}

/**
 * One item's edit inside `tx` (the caller holds the group's knowledge lock): the stale check
 * (`checkStale`), per-type rules, files, visibility (files follow it, non-admin recipients are
 * dropped on a switch to admins), the reminder and `search_text`. A meeting whose start moves
 * (to the future) records `meeting.rescheduled`, and new mentions are recorded, only with
 * `notify` (the later calls of an "all following" edit stay silent).
 */
async function applyUpdate(
  tx: Db,
  actor: SessionUser,
  id: string,
  patch: KnowledgePatch,
  opts: { checkStale: boolean; notify: boolean },
): Promise<{ previousVisibility: Visibility; removedFileIds: string[]; eventIds: string[] }> {
  const row = await lockForWrite(tx, actor, id);
  if (opts.checkStale && row.updated_at !== new Date(patch.updatedAt).toISOString()) {
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
  const remindable = row.type === 'reminder' || row.type === 'meeting';
  if (patch.reminder !== undefined && !remindable) throw new InvalidReminderError();
  // A reminder item keeps at least one time; a meeting's reminder is optional.
  if (row.type === 'reminder' && patch.reminder?.times.length === 0) {
    throw new InvalidReminderError();
  }
  if (patch.meeting !== undefined && row.type !== 'meeting') {
    throw new ValidationError('Only a meeting has meeting fields');
  }
  // A meeting's only file is its recording, which only the transcoder attaches.
  if (row.type === 'meeting' && patch.fileIds !== undefined) throw new InvalidAttachmentError();

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
  let meetingExtras: string[] = [];
  let eventIds: string[] = [];
  if (row.type === 'meeting') {
    const current = await getMeetingRow(tx, id, true);
    if (!current) throw new KnowledgeNotFoundError();
    // A transcript held for admins (Teams T1) cannot be changed by a client who cannot see it
    // (their form would otherwise send the empty text back over it).
    const meetingPatch =
      patch.meeting && current.transcriptAdminsOnly && !isAdmin(actor)
        ? withoutTranscript(patch.meeting)
        : patch.meeting;
    const meeting = meetingPatch ? await patchMeeting(tx, id, meetingPatch, current) : current;
    meetingExtras = meetingSearchExtras(meeting);
    if (opts.notify && meeting.startsAt.getTime() !== current.startsAt.getTime()) {
      eventIds = await recordMeetingScheduled(
        tx,
        'meeting.rescheduled',
        {
          itemId: id,
          groupId: row.group_id,
          title,
          startsAt: meeting.startsAt,
          adminsOnly: visibility === 'admins',
        },
        actor.id,
      );
    }
  }

  if (patch.knowledgeIds) {
    await setLinkedItems(tx, { kind: 'knowledge', id }, row.group_id, patch.knowledgeIds);
  }
  const body = patch.body ?? row.body;
  const searchText = await computeSearchText(tx, {
    groupId: row.group_id,
    title,
    body,
    url,
    fileIds: next,
    extra: meetingExtras,
  });
  await tx
    .update(knowledgeItems)
    .set({ title, body, url, visibility, folderId, searchText, updatedAt: sql`now()` })
    .where(eq(knowledgeItems.id, id));
  // F16: the people the new text names (only admins in an admins-only item).
  const mentions = opts.notify
    ? await recordDescriptionMentions(tx, {
        actor,
        groupId: row.group_id,
        subject: { kind: 'knowledge', id, title, adminsOnly: visibility === 'admins' },
        before: row.body,
        after: body,
      })
    : [];
  return {
    previousVisibility: row.visibility,
    removedFileIds: removed,
    eventIds: [...eventIds, ...mentions],
  };
}

/**
 * Edits an item in one transaction (`applyUpdate`). The caller deletes `removedFileIds` after
 * the commit (`deleteDetachedFiles`). A call of a recurring series with `seriesScope`
 * `following` (ADR 0049) also changes the later calls of the series, each with the same checks
 * as its own edit; they come back in `following` for the live events.
 */
export async function updateItem(
  deps: { db: Db; jobs?: JobQueue },
  actor: SessionUser,
  id: string,
  patch: KnowledgePatch,
): Promise<{
  item: KnowledgeItemDto;
  previousVisibility: Visibility;
  removedFileIds: string[];
  following: { id: string; previousVisibility: Visibility }[];
}> {
  const { db } = deps;
  if ('type' in patch) throw new ValidationError('The type cannot change');
  const scope: MeetingSeriesScope = patch.seriesScope ?? 'this';
  const ref = await getItemRef(db, id);
  if (!ref) throw new KnowledgeNotFoundError();
  const result = await db.transaction(async (tx) => {
    // The group's lock first, then the row: the order of a folder's cascade too.
    await lockGroupKnowledge(tx, ref.groupId);
    const own = await applyUpdate(tx, actor, id, patch, { checkStale: true, notify: true });
    const following =
      scope === 'following'
        ? await updateFollowing(tx, {
            itemId: id,
            patch,
            now: new Date(),
            apply: async (followerId, followerPatch) =>
              (
                await applyUpdate(tx, actor, followerId, followerPatch, {
                  checkStale: false,
                  notify: false,
                })
              ).previousVisibility,
          })
        : [];
    return { ...own, following };
  });
  const { eventIds, ...rest } = result;
  if (deps.jobs) await requestDelivery(deps.jobs, eventIds);
  return { item: await getItem(db, actor, id), ...rest };
}

/**
 * Deletes an item: its files are detached in the transaction and deleted after the commit; the
 * attachments and reminder rows cascade. A call of a recurring series (ADR 0049) with `scope`
 * `following` deletes the later calls too, each with the same checks, and ends the series
 * before it; the plain delete cancels this one call (the series never creates it again).
 * Returns every deleted item.
 */
export async function deleteItem(
  deps: { db: Db; storage: Storage },
  actor: SessionUser,
  id: string,
  scope: MeetingSeriesScope = 'this',
): Promise<{ groupId: string; visibility: Visibility; deleted: DeletedItem[] }> {
  const { db, storage } = deps;
  const ref = scope === 'following' ? await getItemRef(db, id) : null;
  const { deleted, fileIds, uploadKeys } = await db.transaction(async (tx) => {
    // "Following" writes the series too: the group's lock first, as for every series write.
    if (ref) await lockGroupKnowledge(tx, ref.groupId);
    const row = await lockForWrite(tx, actor, id);
    const place = scope === 'following' ? await seriesPlaceOf(tx, id) : null;
    if (scope === 'following' && (row.type !== 'meeting' || !place)) {
      throw new ValidationError('Not a recurring call');
    }
    const rows = [row];
    if (place) {
      const { followerIds } = await endSeriesAt(tx, id);
      for (const followerId of followerIds) rows.push(await lockForWrite(tx, actor, followerId));
    }
    const ids = rows.map((r) => r.id);
    const fileIds = (
      await tx
        .select({ fileId: knowledgeAttachments.fileId })
        .from(knowledgeAttachments)
        .where(inArray(knowledgeAttachments.itemId, ids))
    ).map((r) => r.fileId);
    await detachFiles(tx, fileIds);
    // A meeting's upload still waiting for the transcoder goes too (the job then finds no row).
    const uploadKeys: string[] = [];
    for (const r of rows) {
      if (r.type !== 'meeting') continue;
      const key = (await getMeetingRow(tx, r.id))?.uploadKey ?? null;
      if (key) uploadKeys.push(key);
    }
    await tx.delete(knowledgeItems).where(inArray(knowledgeItems.id, ids));
    if (place) await dropEmptySeries(tx, place.seriesId);
    const deleted = rows.map((r) => ({ id: r.id, groupId: r.group_id, visibility: r.visibility }));
    return { deleted, fileIds, uploadKeys };
  });
  // A failure here leaves detached files, which the daily unattached cleanup removes.
  await deleteDetachedFiles({ db, storage }, fileIds).catch(() => undefined);
  for (const key of uploadKeys) await storage.delete(key).catch(() => undefined);
  return { groupId: deleted[0]!.groupId, visibility: deleted[0]!.visibility, deleted };
}

/** A deleted item, for the live events. */
export type DeletedItem = { id: string; groupId: string; visibility: Visibility };

// ---------------------------------------------------------------------------------------------
// Chat files
// ---------------------------------------------------------------------------------------------

/**
 * Turns a chat file into a normal file item, one way ("Save as a file"): same id, author and time,
 * the given title, description, folder and visibility. The item gets its own copy of the file
 * (`copyFile`) and loses its link to the message, so the message keeps its attachment unchanged
 * and deleting it no longer touches the item; the copy follows the item's visibility like any
 * file item's. The copy is made before the transaction (storage work holds no lock) and removed
 * again when the transaction fails. An item that is no chat file is ValidationError.
 */
export async function convertChatFile(
  deps: { db: Db; storage: Storage },
  actor: SessionUser,
  id: string,
  input: KnowledgeToFile,
): Promise<{ item: KnowledgeItemDto; previousVisibility: Visibility }> {
  const { db } = deps;
  const [row] = await db.execute<{
    group_id: string;
    type: KnowledgeType;
    visibility: Visibility;
    created_by: string;
    chat_file_id: string | null;
    updated_at: string;
    author_role: string;
  }>(sql`
    select k.group_id, k.type, k.visibility, k.created_by, k.chat_file_id,
           ${iso(sql`k.updated_at`)} as updated_at, u.role as author_role
    from knowledge_items k join "user" u on u.id = k.created_by where k.id = ${id}`);
  if (!row) throw new KnowledgeNotFoundError();
  const actorGroupIds = await actorGroupOf(db, actor);
  const ref = {
    groupId: row.group_id,
    visibility: row.visibility,
    createdBy: row.created_by,
    type: row.type,
  };
  if (!canReadItem(actor, ref, actorGroupIds)) throw new KnowledgeNotFoundError();
  if (row.type !== 'chat_file' || row.chat_file_id === null) {
    throw new ValidationError('Not a chat file');
  }
  if (!canConvertChatFile(actor, ref, actorGroupIds)) throw new KnowledgeForbiddenError();
  const seen = new Date(input.updatedAt).toISOString();
  if (row.updated_at !== seen) throw new KnowledgeChangedError();
  const authorIsClient = row.author_role === 'client';
  if (!canSetVisibility(actor, { authorIsClient }, input.visibility)) {
    throw new InvalidVisibilityError();
  }

  const copy = await copyFile(deps, {
    fileId: row.chat_file_id,
    groupId: row.group_id,
    userId: actor.id,
  });
  try {
    await db.transaction(async (tx) => {
      await lockGroupKnowledge(tx, row.group_id);
      const locked = await lockForWrite(tx, actor, id, canConvertChatFile);
      // A message deleted, a ticket moved or a conversion committed since the read above.
      if (locked.updated_at !== seen || locked.group_id !== row.group_id) {
        throw new KnowledgeChangedError();
      }
      const folder = await folderForItem(tx, actor, row.group_id, input.folderId);
      // Inside an admins-only folder everything is admins-only, as for a new item.
      const visibility: Visibility = folder?.visibility === 'admins' ? 'admins' : input.visibility;
      if (!canSetVisibility(actor, { authorIsClient }, visibility)) {
        throw new InvalidVisibilityError();
      }
      await attachFiles(tx, row.group_id, [copy.id], actor.id);
      await tx.insert(knowledgeAttachments).values({ itemId: id, fileId: copy.id });
      await setFilesAdminsOnly(tx, [copy.id], visibility === 'admins');
      const searchText = await computeSearchText(tx, {
        groupId: row.group_id,
        title: input.title,
        body: input.body,
        url: null,
        fileIds: [copy.id],
      });
      await tx
        .update(knowledgeItems)
        .set({
          type: 'file',
          title: input.title,
          body: input.body,
          visibility,
          folderId: input.folderId,
          searchText,
          chatMessageId: null,
          chatFileId: null,
          chatChannelId: null,
          chatKind: null,
          updatedAt: sql`now()`,
        })
        .where(eq(knowledgeItems.id, id));
    });
  } catch (error) {
    // Only removed while still unattached, so a committed copy is never touched.
    await deleteDetachedFiles(deps, [copy.id]).catch(() => undefined);
    throw error;
  }
  return { item: await getItem(db, actor, id), previousVisibility: row.visibility };
}

/** The "From chat" items of one message, as list rows (for the live event after a send). */
export async function chatFileSummaries(db: Db, messageId: string): Promise<KnowledgeSummary[]> {
  const rows = [
    ...(await db.execute<PageRow>(
      pageQuery(sql`k.chat_message_id = ${messageId}`, KNOWLEDGE_LIMITS.pageSize),
    )),
  ];
  return rows.map((row) => toSummary(row, new Map()));
}

/**
 * One item as a list row, for a live event after a job changed it (no access check): the row
 * admins get and the one clients get (they differ while a summary is held for admins).
 */
export async function getItemSummary(
  db: Db,
  id: string,
): Promise<{ admin: KnowledgeSummary; client: KnowledgeSummary } | null> {
  const [row] = [...(await db.execute<PageRow>(pageQuery(sql`k.id = ${id}`, 1)))];
  if (!row) return null;
  const [names, pathOf] = await Promise.all([
    mentionNames(db, [{ groupId: row.group_id, body: row.body_head }]),
    pathsOf(db, [row]),
  ]);
  const summary = (viewerIsAdmin: boolean) =>
    toSummary(row, namesIn(names, row.group_id), rowPath(row, pathOf), viewerIsAdmin);
  return { admin: summary(true), client: summary(false) };
}

/** A meeting edit without the transcript and the summary. */
function withoutTranscript(patch: MeetingPatch): MeetingPatch {
  const rest = { ...patch };
  delete rest.transcript;
  delete rest.summary;
  return rest;
}
