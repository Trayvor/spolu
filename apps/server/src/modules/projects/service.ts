import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  PROJECT_LIMITS,
  type EventCreateBody,
  type EventPatchBody,
  type EventPickerItem,
  type FileInfo,
  type ProjectCreateBody,
  type ProjectDto,
  type ProjectEventDto,
  type ProjectListItem,
  type ProjectPage,
  type ProjectPatchBody,
  type ProjectStatus,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import type { Storage } from '../../infra/storage/storage.js';
import { normalizeSearch } from '../../infra/text/search.js';
import { files } from '../files/schema.js';
import { attachFiles, deleteDetachedFiles, detachFiles, toFileInfo } from '../files/service.js';
import { linkedCardsOf, setLinkedItems } from '../knowledge/links.js';
import { openTaskCountsByProject } from '../tasks/by-project.js';
import { openTicketCountsByProject } from '../tickets/by-project.js';
import { recordDescriptionMentions } from '../notifications/description-mentions.js';
import { requestDelivery } from '../notifications/service.js';
import { getUserNames } from '../users/service.js';
import {
  ProjectChangedError,
  ProjectNameTakenError,
  ProjectNotFoundError,
  ProjectValidationError,
} from './errors.js';
import { colorOf, lockGroupProjects } from './refs.js';
import { projectAttachments, projectEvents, projectNameKeys, projects } from './schema.js';

/**
 * Projects and events (Phase 33 part P1, spec §3, §5.6, §7.5, §7.6). The routes check the policy
 * first; nothing here checks the actor again. Writes of one client run under
 * `lockGroupProjects`, so name keys stay one project per key.
 */

type Deps = { db: Db; storage: Storage };

/**
 * F16: who wrote a description and the queue its mention notifications go to. Optional so a
 * write without a person behind it (a backfill, a test) notifies nobody.
 */
export type MentionNotify = { actor: Pick<SessionUser, 'id' | 'name'>; jobs: JobQueue };
type ProjectRow = typeof projects.$inferSelect;
type EventRow = typeof projectEvents.$inferSelect;

/** Today in Bratislava, as SQL (the timeline's and the card's "coming" events). */
const TODAY = sql`(now() at time zone 'Europe/Bratislava')::date`;

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** A cursor the server did not make (400). */
export class InvalidProjectCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidProjectCursorError';
  }
}

const encodeCursor = (nameKey: string, id: string) =>
  Buffer.from(JSON.stringify([nameKey, id])).toString('base64url');

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 200)
    ) {
      return value as [string, string];
    }
  } catch {
    // Falls through to the error.
  }
  throw new InvalidProjectCursorError();
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────

type ListRow = {
  id: string;
  group_id: string;
  name: string;
  name_key: string;
  status: ProjectStatus;
  source: 'manual' | 'egrant';
  updated_at: string;
  event_count: number;
  next_id: string | null;
  next_name: string | null;
  next_on: string | null;
  egrant_changes: number;
};

/**
 * The rows of the projects card and of one project: each row's event count, next coming event
 * and pending eGrant changes are index lookups (`project_events_project_occurs_idx`,
 * `egrant_changes_project_pending_idx`); open tasks and tickets come from their modules, one
 * grouped count each for the whole page.
 */
async function listRows(db: Db, where: ReturnType<typeof sql>, limit: number): Promise<ListRow[]> {
  return [
    ...(await db.execute<ListRow>(sql`
      select p.id, p.group_id, p.name, p.name_key, p.status, p.source,
             to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
             (select count(*)::int from project_events e
               where e.project_id = p.id and e.group_id = p.group_id) as event_count,
             n.id as next_id, n.name as next_name, n.occurs_on::text as next_on,
             (select count(*)::int from egrant_changes c
               where c.project_id = p.id and c.state = 'pending') as egrant_changes
      from projects p
      left join lateral (
        select e.id, e.name, e.occurs_on from project_events e
        where e.project_id = p.id and e.group_id = p.group_id and e.occurs_on >= ${TODAY}
        order by e.occurs_on, e.id limit 1
      ) n on true
      where ${where}
      order by p.name_key, p.id
      limit ${limit}`)),
  ];
}

async function toListItems(db: Db, groupId: string, rows: ListRow[]): Promise<ProjectListItem[]> {
  const ids = rows.map((r) => r.id);
  const [openTasks, openTickets] = await Promise.all([
    openTaskCountsByProject(db, groupId, ids),
    openTicketCountsByProject(db, groupId, ids),
  ]);
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    color: colorOf(row.id),
    status: row.status,
    source: row.source,
    eventCount: row.event_count,
    nextEvent:
      row.next_id === null
        ? null
        : { id: row.next_id, name: row.next_name!, occursOn: row.next_on! },
    openTasks: openTasks.get(row.id) ?? 0,
    openTickets: openTickets.get(row.id) ?? 0,
    egrantChanges: row.egrant_changes,
    updatedAt: row.updated_at,
  }));
}

/** One page of the projects card: 30 by name, active or archived. */
export async function listProjects(
  db: Db,
  groupId: string,
  query: { status: ProjectStatus; after?: string },
): Promise<ProjectPage> {
  const size = PROJECT_LIMITS.pageSize;
  const parts = [sql`p.group_id = ${groupId}`, sql`p.status = ${query.status}`];
  if (query.after) {
    const [nameKey, id] = decodeCursor(query.after);
    parts.push(sql`(p.name_key, p.id) > (${nameKey}, ${id})`);
  }
  const rows = await listRows(db, sql.join(parts, sql` and `), size + 1);
  const page = rows.slice(0, size);
  return {
    items: await toListItems(db, groupId, page),
    nextCursor:
      rows.length > size
        ? encodeCursor(page[page.length - 1]!.name_key, page[page.length - 1]!.id)
        : null,
  };
}

/** The client of a project, or null for an unknown id. */
export async function projectGroupId(db: Db, id: string): Promise<string | null> {
  const [row] = await db
    .select({ groupId: projects.groupId })
    .from(projects)
    .where(eq(projects.id, id));
  return row?.groupId ?? null;
}

/** The client of each of these projects that exists, by id, in one query (2026-10-18). */
export async function projectGroupIds(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, groupId: projects.groupId })
    .from(projects)
    .where(inArray(projects.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.groupId]));
}

/** The client of each of these events that exists, by id, in one query (2026-10-18). */
export async function eventGroupIds(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: projectEvents.id, groupId: projectEvents.groupId })
    .from(projectEvents)
    .where(inArray(projectEvents.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.groupId]));
}

/** The client and project of an event, or null for an unknown id. */
export async function eventOwner(
  db: Db,
  id: string,
): Promise<{ groupId: string; projectId: string } | null> {
  const [row] = await db
    .select({ groupId: projectEvents.groupId, projectId: projectEvents.projectId })
    .from(projectEvents)
    .where(eq(projectEvents.id, id));
  return row ?? null;
}

async function attachedFiles(
  db: Db,
  owner: { projectId: string } | { eventId: string },
): Promise<FileInfo[]> {
  const rows = await db
    .select({ file: files })
    .from(projectAttachments)
    .innerJoin(files, eq(files.id, projectAttachments.fileId))
    .where(
      'projectId' in owner
        ? eq(projectAttachments.projectId, owner.projectId)
        : eq(projectAttachments.eventId, owner.eventId),
    )
    .orderBy(asc(files.createdAt), asc(files.id));
  return rows.map((r) => toFileInfo(r.file));
}

async function person(db: Db, id: string | null) {
  if (id === null) return null;
  const name = (await getUserNames(db, [id])).get(id);
  return name === undefined ? null : { id, name };
}

/** One project with its files, aliases and author. */
export async function getProject(db: Db, id: string): Promise<ProjectDto> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) throw new ProjectNotFoundError();
  const [listRow] = await listRows(db, sql`p.id = ${id}`, 1);
  const [[item], fileList, keys, createdBy, linkedKnowledge] = await Promise.all([
    toListItems(db, row.groupId, [listRow!]),
    attachedFiles(db, { projectId: id }),
    db
      .select({ key: projectNameKeys.key })
      .from(projectNameKeys)
      .where(
        and(
          eq(projectNameKeys.projectId, id),
          eq(projectNameKeys.groupId, row.groupId),
          eq(projectNameKeys.kind, 'name'),
          ne(projectNameKeys.key, row.nameKey),
        ),
      )
      .orderBy(asc(projectNameKeys.key)),
    person(db, row.createdBy),
    linkedCardsOf(db, 'project', id, row.groupId),
  ]);
  return {
    ...item!,
    description: row.description,
    files: fileList,
    aliases: keys.map((k) => k.key),
    egrantProjectId: row.egrantProjectId,
    createdBy,
    createdAt: row.createdAt.toISOString(),
    archivedAt: iso(row.archivedAt),
    linkedKnowledge,
  };
}

/** A project's events for a select and the project sheet, by date. */
export async function listEventPicker(db: Db, projectId: string): Promise<EventPickerItem[]> {
  return db
    .select({
      id: projectEvents.id,
      name: projectEvents.name,
      occursOn: projectEvents.occursOn,
      source: projectEvents.source,
    })
    .from(projectEvents)
    .where(eq(projectEvents.projectId, projectId))
    .orderBy(asc(projectEvents.occursOn), asc(projectEvents.createdAt), asc(projectEvents.id));
}

/** One event with its project, files and author. */
export async function getEvent(db: Db, id: string): Promise<ProjectEventDto> {
  const [row] = await db
    .select({ event: projectEvents, projectName: projects.name })
    .from(projectEvents)
    .innerJoin(projects, eq(projects.id, projectEvents.projectId))
    .where(eq(projectEvents.id, id));
  if (!row) throw new ProjectNotFoundError();
  const e: EventRow = row.event;
  const [fileList, createdBy, linkedKnowledge] = await Promise.all([
    attachedFiles(db, { eventId: id }),
    person(db, e.createdBy),
    linkedCardsOf(db, 'event', id, e.groupId),
  ]);
  return {
    id: e.id,
    projectId: e.projectId,
    groupId: e.groupId,
    project: { id: e.projectId, name: row.projectName, color: colorOf(e.projectId) },
    name: e.name,
    description: e.description,
    occursOn: e.occursOn,
    source: e.source,
    files: fileList,
    createdBy,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    linkedKnowledge,
  };
}

// ── Name keys ──────────────────────────────────────────────────────────────────────────────────

/**
 * Gives the project the name key (under `lockGroupProjects`): kept when it is the project's own
 * already, refused with the other project's name when another project of the client holds it.
 */
async function claimNameKey(
  tx: Db,
  groupId: string,
  projectId: string,
  key: string,
): Promise<void> {
  const inserted = await tx
    .insert(projectNameKeys)
    .values({ projectId, groupId, kind: 'name', key })
    .onConflictDoNothing()
    .returning({ key: projectNameKeys.key });
  if (inserted.length > 0) return;
  const [owner] = await tx
    .select({ projectId: projectNameKeys.projectId, name: projects.name })
    .from(projectNameKeys)
    .innerJoin(projects, eq(projects.id, projectNameKeys.projectId))
    .where(
      and(
        eq(projectNameKeys.groupId, groupId),
        eq(projectNameKeys.kind, 'name'),
        eq(projectNameKeys.key, key),
      ),
    );
  if (owner && owner.projectId !== projectId) throw new ProjectNameTakenError(owner.name);
}

/** Removes an alias (an old name's key) of a project; never its current name's. */
export async function removeAlias(db: Db, projectId: string, key: string): Promise<void> {
  const groupId = await projectGroupId(db, projectId);
  if (groupId === null) throw new ProjectNotFoundError();
  await db.transaction(async (tx) => {
    await lockGroupProjects(tx, groupId);
    const [row] = await tx
      .select({ nameKey: projects.nameKey })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!row) throw new ProjectNotFoundError();
    if (row.nameKey === key) throw new ProjectValidationError('The current name is not an alias');
    const gone = await tx
      .delete(projectNameKeys)
      .where(
        and(
          eq(projectNameKeys.groupId, groupId),
          eq(projectNameKeys.kind, 'name'),
          eq(projectNameKeys.key, key),
          eq(projectNameKeys.projectId, projectId),
        ),
      )
      .returning({ key: projectNameKeys.key });
    if (gone.length === 0) throw new ProjectNotFoundError();
    await tx
      .update(projects)
      .set({ updatedAt: sql`now()` })
      .where(eq(projects.id, projectId));
  });
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Sets the files of a project or an event to `next` in the caller's transaction: new ones are
 * attached (the caller's own unattached files of the client), dropped ones detached. Returns the
 * dropped ids, deleted by the caller after the commit.
 */
async function syncFiles(
  tx: Db,
  groupId: string,
  actorId: string,
  owner: { projectId: string } | { eventId: string },
  next: string[],
): Promise<string[]> {
  const ownerWhere =
    'projectId' in owner
      ? eq(projectAttachments.projectId, owner.projectId)
      : eq(projectAttachments.eventId, owner.eventId);
  const current = (
    await tx
      .select({ fileId: projectAttachments.fileId })
      .from(projectAttachments)
      .where(ownerWhere)
  ).map((r) => r.fileId);
  const added = next.filter((id) => !current.includes(id));
  const dropped = current.filter((id) => !next.includes(id));
  if (added.length > 0) {
    await attachFiles(tx, groupId, added, actorId);
    await tx
      .insert(projectAttachments)
      .values(
        added.map((fileId) =>
          'projectId' in owner
            ? { fileId, projectId: owner.projectId }
            : { fileId, eventId: owner.eventId },
        ),
      );
  }
  if (dropped.length > 0) {
    await tx
      .delete(projectAttachments)
      .where(and(ownerWhere, inArray(projectAttachments.fileId, dropped)));
    await detachFiles(tx, dropped);
  }
  return dropped;
}

/** After a commit: deletes files no longer attached (a failure leaves them to the daily cleanup). */
async function dropFiles(deps: Deps, ids: string[]): Promise<void> {
  await deleteDetachedFiles(deps, ids).catch(() => undefined);
}

// ── Project writes ─────────────────────────────────────────────────────────────────────────────

/** Creates a project of the client with its name key and files. */
export async function createProject(
  db: Db,
  actorId: string,
  groupId: string,
  body: ProjectCreateBody,
  notify?: MentionNotify,
): Promise<ProjectDto> {
  const id = randomUUID();
  const nameKey = normalizeSearch(body.name);
  const mentions = await db.transaction(async (tx) => {
    await lockGroupProjects(tx, groupId);
    await tx.insert(projects).values({
      id,
      groupId,
      name: body.name,
      nameKey,
      description: body.description,
      createdBy: actorId,
    });
    await claimNameKey(tx, groupId, id, nameKey);
    await syncFiles(tx, groupId, actorId, { projectId: id }, body.fileIds);
    if (body.knowledgeIds) {
      await setLinkedItems(tx, { kind: 'project', id }, groupId, body.knowledgeIds);
    }
    if (!notify) return [];
    return recordDescriptionMentions(tx, {
      actor: notify.actor,
      groupId,
      subject: { kind: 'project', id, title: body.name },
      before: null,
      after: body.description,
    });
  });
  if (notify) await requestDelivery(notify.jobs, mentions);
  return getProject(db, id);
}

/** Locks the project's client and row; checks `updatedAt` when given. */
async function lockProject(
  tx: Db,
  groupId: string,
  id: string,
  updatedAt?: string,
): Promise<ProjectRow> {
  await lockGroupProjects(tx, groupId);
  const [row] = await tx.select().from(projects).where(eq(projects.id, id)).for('update');
  if (!row) throw new ProjectNotFoundError();
  if (updatedAt !== undefined && row.updatedAt.getTime() !== Date.parse(updatedAt)) {
    throw new ProjectChangedError();
  }
  return row;
}

/**
 * Edits a project: the `updatedAt` check, a rename's new name key (the old one stays as an
 * alias), the files.
 */
export async function updateProject(
  deps: Deps,
  actorId: string,
  id: string,
  patch: ProjectPatchBody,
  notify?: MentionNotify,
): Promise<ProjectDto> {
  const { db } = deps;
  const groupId = await projectGroupId(db, id);
  if (groupId === null) throw new ProjectNotFoundError();
  const { removed: dropped, mentions } = await db.transaction(async (tx) => {
    const row = await lockProject(tx, groupId, id, patch.updatedAt);
    const name = patch.name ?? row.name;
    const nameKey = normalizeSearch(name);
    if (nameKey !== row.nameKey) await claimNameKey(tx, groupId, id, nameKey);
    const removed = patch.fileIds
      ? await syncFiles(tx, groupId, actorId, { projectId: id }, patch.fileIds)
      : [];
    if (patch.knowledgeIds) {
      await setLinkedItems(tx, { kind: 'project', id }, groupId, patch.knowledgeIds);
    }
    await tx
      .update(projects)
      .set({
        name,
        nameKey,
        description: patch.description ?? row.description,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, id));
    const mentions =
      notify && patch.description !== undefined
        ? await recordDescriptionMentions(tx, {
            actor: notify.actor,
            groupId,
            subject: { kind: 'project', id, title: name },
            before: row.description,
            after: patch.description,
          })
        : [];
    return { removed, mentions };
  });
  await dropFiles(deps, dropped);
  if (notify) await requestDelivery(notify.jobs, mentions);
  return getProject(db, id);
}

/** Archives or restores a project (decision 11): no `updatedAt` check, the state is the request. */
export async function setProjectStatus(
  db: Db,
  id: string,
  status: ProjectStatus,
): Promise<ProjectDto> {
  const groupId = await projectGroupId(db, id);
  if (groupId === null) throw new ProjectNotFoundError();
  await db.transaction(async (tx) => {
    const row = await lockProject(tx, groupId, id);
    if (row.status === status) return;
    await tx
      .update(projects)
      .set({
        status,
        archivedAt: status === 'archived' ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, id));
  });
  return getProject(db, id);
}

/**
 * Deletes a project with its events, files, name keys, links and pending changes. Its tasks and
 * tickets stay and lose it: the events go first (their FK clears `event_id`), then the project
 * (its FK clears `project_id`), so the "event needs a project" CHECK holds in between.
 */
export async function deleteProject(deps: Deps, id: string): Promise<{ groupId: string }> {
  const { db } = deps;
  const groupId = await projectGroupId(db, id);
  if (groupId === null) throw new ProjectNotFoundError();
  const fileIds = await db.transaction(async (tx) => {
    await lockProject(tx, groupId, id);
    const rows = await tx.execute<{ file_id: string }>(sql`
      select a.file_id from project_attachments a where a.project_id = ${id}
      union all
      select a.file_id from project_attachments a
      join project_events e on e.id = a.event_id where e.project_id = ${id}`);
    const ids = [...rows].map((r) => r.file_id);
    await tx.delete(projectEvents).where(eq(projectEvents.projectId, id));
    await tx.delete(projects).where(eq(projects.id, id));
    await detachFiles(tx, ids);
    return ids;
  });
  await dropFiles(deps, fileIds);
  return { groupId };
}

// ── Event writes ───────────────────────────────────────────────────────────────────────────────

/** Adds an event (any date, past ones too) to a project. */
export async function createEvent(
  db: Db,
  actorId: string,
  projectId: string,
  body: EventCreateBody,
): Promise<ProjectEventDto> {
  const groupId = await projectGroupId(db, projectId);
  if (groupId === null) throw new ProjectNotFoundError();
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await lockProject(tx, groupId, projectId);
    await tx.insert(projectEvents).values({
      id,
      projectId,
      groupId,
      name: body.name,
      nameKey: normalizeSearch(body.name),
      description: body.description,
      occursOn: body.occursOn,
      createdBy: actorId,
    });
    await syncFiles(tx, groupId, actorId, { eventId: id }, body.fileIds);
    if (body.knowledgeIds) {
      await setLinkedItems(tx, { kind: 'event', id }, groupId, body.knowledgeIds);
    }
  });
  return getEvent(db, id);
}

/** Edits an event: the `updatedAt` check, name, date, description and files. */
export async function updateEvent(
  deps: Deps,
  actorId: string,
  id: string,
  patch: EventPatchBody,
): Promise<ProjectEventDto> {
  const { db } = deps;
  const owner = await eventOwner(db, id);
  if (owner === null) throw new ProjectNotFoundError();
  const dropped = await db.transaction(async (tx) => {
    await lockGroupProjects(tx, owner.groupId);
    const [row] = await tx
      .select()
      .from(projectEvents)
      .where(eq(projectEvents.id, id))
      .for('update');
    if (!row) throw new ProjectNotFoundError();
    if (row.updatedAt.getTime() !== Date.parse(patch.updatedAt)) throw new ProjectChangedError();
    const removed = patch.fileIds
      ? await syncFiles(tx, owner.groupId, actorId, { eventId: id }, patch.fileIds)
      : [];
    if (patch.knowledgeIds) {
      await setLinkedItems(tx, { kind: 'event', id }, owner.groupId, patch.knowledgeIds);
    }
    const name = patch.name ?? row.name;
    await tx
      .update(projectEvents)
      .set({
        name,
        nameKey: normalizeSearch(name),
        description: patch.description ?? row.description,
        occursOn: patch.occursOn ?? row.occursOn,
        updatedAt: sql`now()`,
      })
      .where(eq(projectEvents.id, id));
    return removed;
  });
  await dropFiles(deps, dropped);
  return getEvent(db, id);
}

/** Deletes an event with its files and pending changes; its tasks and tickets keep the project. */
export async function deleteEvent(
  deps: Deps,
  id: string,
): Promise<{ groupId: string; projectId: string }> {
  const { db } = deps;
  const owner = await eventOwner(db, id);
  if (owner === null) throw new ProjectNotFoundError();
  const fileIds = await db.transaction(async (tx) => {
    await lockGroupProjects(tx, owner.groupId);
    const ids = (
      await tx
        .select({ fileId: projectAttachments.fileId })
        .from(projectAttachments)
        .where(eq(projectAttachments.eventId, id))
    ).map((r) => r.fileId);
    const gone = await tx
      .delete(projectEvents)
      .where(eq(projectEvents.id, id))
      .returning({ id: projectEvents.id });
    if (gone.length === 0) throw new ProjectNotFoundError();
    await detachFiles(tx, ids);
    return ids;
  });
  await dropFiles(deps, fileIds);
  return owner;
}
