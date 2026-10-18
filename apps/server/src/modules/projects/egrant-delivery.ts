import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  EgrantProjectBodySchema,
  parseEgrantDate,
  type EgrantChangeDto,
  type EgrantChangeKind,
  type EgrantChangeList,
  type EgrantProjectBody,
  type EgrantReviewBody,
  type ProjectDto,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { normalizeSearch } from '../../infra/text/search.js';
import { deleteDetachedFiles, detachFiles } from '../files/service.js';
import { linkWaitingTickets } from '../tickets/egrant-link.js';
import { ProjectNotFoundError } from './errors.js';
import { findEgrantProject } from './egrant-match.js';
import { lockGroupProjects } from './refs.js';
import {
  egrantChanges,
  egrantProjectInbox,
  projectAttachments,
  projectEvents,
  projectNameKeys,
  projects,
} from './schema.js';
import { claimNameKey, getProject, projectGroupId } from './service.js';
import { egrantActor, type AuditActor } from '../audit/actor.js';
import { diffFields, hasChanges } from '../audit/diff.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';
import { eventEntry, eventValues, projectEntry, projectValues } from './audit.js';

/**
 * eGrant project deliveries and their review (Phase 33 part P3, spec §5.1–§5.4). The endpoint
 * (`egrant-routes.ts`) authenticates eGrant and finds the client; everything here runs in one
 * transaction under the client's project lock, so two deliveries at once create one project.
 * Nothing a person wrote is overwritten: every difference becomes a pending change.
 */

type ProjectRow = typeof projects.$inferSelect;
type EventRow = typeof projectEvents.$inferSelect;
type ChangeRow = typeof egrantChanges.$inferSelect;

export type DeliveryResult = {
  projectId: string;
  state: 'created' | 'unchanged' | 'pending' | 'stale';
  /** Pending changes after the delivery. */
  pending: number;
  /** The skipped events, as `events[2].date`. */
  skipped: string[];
  /** Tickets that waited for this project and are linked now (for `ticket:updated`). */
  linkedTicketIds: string[];
};

/** A review names a change that is no longer pending as it was read (409 `change_outdated`). */
export class ChangeOutdatedError extends Error {
  constructor() {
    super('An eGrant change changed meanwhile');
    this.name = 'ChangeOutdatedError';
  }
}

/** A valid event of a delivery. */
type DeliveredEvent = {
  index: number;
  name: string;
  nameKey: string;
  /** `YYYY-MM-DD`. */
  date: string;
  description: string;
};

/**
 * The valid events of a delivery, in order, and the skipped ones as field names (spec §5.3): an
 * empty name (`events[i].name`), a date that is not a real `dd.mm.yyyy` (`events[i].date`), or
 * the same name key and date as an earlier event of the delivery (`events[i]`).
 */
export function parseDeliveredEvents(events: EgrantProjectBody['events']): {
  events: DeliveredEvent[];
  skipped: string[];
} {
  const valid: DeliveredEvent[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  events.forEach((event, index) => {
    const nameKey = normalizeSearch(event.name);
    if (nameKey === '') return void skipped.push(`events[${index}].name`);
    const date = parseEgrantDate(event.date);
    if (date === null) return void skipped.push(`events[${index}].date`);
    const key = `${nameKey}|${date}`;
    if (seen.has(key)) return void skipped.push(`events[${index}]`);
    seen.add(key);
    valid.push({ index, name: event.name, nameKey, date, description: event.description });
  });
  return { events: valid, skipped };
}

const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One field of a delivery compared with the project: the row it wants in `egrant_changes`. */
type WantedChange = {
  kind: EgrantChangeKind;
  eventId: string | null;
  eventKey: string | null;
  value: unknown;
  /** The incoming value equals the current one: no change row. */
  equal: boolean;
};

const targetOf = (c: { kind: string; eventId: string | null; eventKey: string | null }) =>
  `${c.kind}|${c.eventId ?? c.eventKey ?? ''}`;

/**
 * Pairs the delivered events with the project's eGrant events by the identity eGrant last gave
 * them (decision 6b, spec §5.4): same name and date, then a unique same name (a redate), then a
 * unique same date (a rename). Returns the pairs and what is left on each side.
 */
export function pairEvents<E extends Pick<EventRow, 'egrantNameKey' | 'egrantDate'>>(
  existing: readonly E[],
  delivered: readonly DeliveredEvent[],
): { pairs: [E, DeliveredEvent][]; added: DeliveredEvent[]; removed: E[] } {
  const openE = [...existing];
  const openD = [...delivered];
  const pairs: [E, DeliveredEvent][] = [];
  const take = (e: E, d: DeliveredEvent) => {
    pairs.push([e, d]);
    openE.splice(openE.indexOf(e), 1);
    openD.splice(openD.indexOf(d), 1);
  };
  for (const d of [...openD]) {
    const e = openE.find((x) => x.egrantNameKey === d.nameKey && x.egrantDate === d.date);
    if (e) take(e, d);
  }
  const unique = (
    sameE: (e: E, d: DeliveredEvent) => boolean,
    sameD: (a: DeliveredEvent, b: DeliveredEvent) => boolean,
  ) => {
    // Candidates are fixed before pairing, so the order of the delivery never decides.
    const found: [E, DeliveredEvent][] = [];
    for (const d of openD) {
      const es = openE.filter((e) => sameE(e, d));
      if (es.length !== 1) continue;
      const ds = openD.filter((x) => sameE(es[0]!, x) && sameD(x, d));
      if (ds.length === 1) found.push([es[0]!, d]);
    }
    for (const [e, d] of found) take(e, d);
  };
  unique(
    (e, d) => e.egrantNameKey === d.nameKey,
    (a, b) => a.nameKey === b.nameKey,
  );
  unique(
    (e, d) => e.egrantDate === d.date,
    (a, b) => a.date === b.date,
  );
  return { pairs, added: openD, removed: openE };
}

/** Creates the project of a first delivery with its valid events, all "From eGrant". */
async function createFromDelivery(
  tx: Db,
  groupId: string,
  egrantProjectId: string,
  body: EgrantProjectBody,
  events: DeliveredEvent[],
  sentAt: Date,
  by: AuditActor | undefined,
): Promise<string> {
  const id = randomUUID();
  const nameKey = normalizeSearch(body.name);
  await tx.insert(projects).values({
    id,
    groupId,
    name: body.name,
    nameKey,
    description: body.description,
    source: 'egrant',
    egrantProjectId,
    egrantDeliveredAt: new Date(),
    egrantSentAt: sentAt,
  });
  await tx
    .insert(projectNameKeys)
    .values({ projectId: id, groupId, kind: 'egrant_id', key: egrantProjectId });
  // A project linked to another eGrant id may hold the name already: the new one goes without
  // the name key (eGrant matches by its id; people can rename either).
  if (nameKey !== '') {
    await tx
      .insert(projectNameKeys)
      .values({ projectId: id, groupId, kind: 'name', key: nameKey })
      .onConflictDoNothing();
  }
  const eventRows = events.map((e) => ({ ...e, id: randomUUID() }));
  if (by) {
    // A first delivery creates the project and its events at once: eGrant is the author.
    await recordAudit(tx, by, [
      projectEntry(
        { id, groupId, name: body.name },
        'created',
        diffFields('project', null, { ...projectValues(body), status: 'active' }),
      ),
      ...eventRows.map((e) =>
        eventEntry(
          { id: e.id, groupId, name: e.name },
          'created',
          diffFields('project_event', null, eventValues({ ...e, occursOn: e.date })),
        ),
      ),
    ]);
  }
  if (events.length > 0) {
    await tx.insert(projectEvents).values(
      eventRows.map((e) => ({
        id: e.id,
        projectId: id,
        groupId,
        name: e.name,
        nameKey: e.nameKey,
        description: e.description,
        occursOn: e.date,
        source: 'egrant' as const,
        egrantNameKey: e.nameKey,
        egrantDate: e.date,
      })),
    );
  }
  return id;
}

/**
 * A project a person created with the delivery's name key (or an alias of it) and no eGrant id
 * yet (decision 3, step 2), or null.
 */
async function personProjectByName(
  tx: Db,
  groupId: string,
  nameKey: string,
): Promise<string | null> {
  if (nameKey === '') return null;
  const [row] = await tx
    .select({ id: projects.id, egrantProjectId: projects.egrantProjectId })
    .from(projectNameKeys)
    .innerJoin(projects, eq(projects.id, projectNameKeys.projectId))
    .where(
      and(
        eq(projectNameKeys.groupId, groupId),
        eq(projectNameKeys.kind, 'name'),
        eq(projectNameKeys.key, nameKey),
      ),
    );
  if (!row || row.egrantProjectId !== null) return null;
  // A merged project's survivor may carry other eGrant ids as key rows only.
  const [other] = await tx
    .select({ key: projectNameKeys.key })
    .from(projectNameKeys)
    .where(and(eq(projectNameKeys.projectId, row.id), eq(projectNameKeys.kind, 'egrant_id')))
    .limit(1);
  return other ? null : row.id;
}

/** What a delivery wants in `egrant_changes` for an existing project. */
async function diffDelivery(
  tx: Db,
  project: ProjectRow,
  body: EgrantProjectBody,
  delivered: DeliveredEvent[],
): Promise<WantedChange[]> {
  const wanted: WantedChange[] = [
    {
      kind: 'project_name',
      eventId: null,
      eventKey: null,
      value: body.name,
      equal: body.name === project.name,
    },
    {
      kind: 'project_description',
      eventId: null,
      eventKey: null,
      value: body.description,
      equal: body.description === project.description,
    },
  ];
  const existing = await tx
    .select()
    .from(projectEvents)
    .where(and(eq(projectEvents.projectId, project.id), eq(projectEvents.source, 'egrant')))
    .orderBy(asc(projectEvents.occursOn), asc(projectEvents.createdAt), asc(projectEvents.id));
  const { pairs, added, removed } = pairEvents(existing, delivered);
  for (const [e, d] of pairs) {
    // The identity eGrant gave the event follows every delivery, whatever people accept.
    if (e.egrantNameKey !== d.nameKey || e.egrantDate !== d.date) {
      await tx
        .update(projectEvents)
        .set({ egrantNameKey: d.nameKey, egrantDate: d.date })
        .where(eq(projectEvents.id, e.id));
    }
    const field = (kind: EgrantChangeKind, value: string, current: string) =>
      wanted.push({ kind, eventId: e.id, eventKey: null, value, equal: value === current });
    field('event_name', d.name, e.name);
    field('event_date', d.date, e.occursOn);
    field('event_description', d.description, e.description);
  }
  for (const d of added) {
    wanted.push({
      kind: 'event_add',
      eventId: null,
      eventKey: `${d.nameKey}|${d.date}`,
      value: { name: d.name, occursOn: d.date, description: d.description },
      equal: false,
    });
  }
  for (const e of removed) {
    wanted.push({
      kind: 'event_remove',
      eventId: e.id,
      eventKey: null,
      value: { nameKey: e.egrantNameKey, date: e.egrantDate },
      equal: false,
    });
  }
  return wanted;
}

/**
 * Writes the wanted changes (spec §5.4): an equal value deletes the row, a dismissed row with the
 * same value stays dismissed, anything else is pending with the new value. A row whose value
 * changes gets a new id, so a review of the old one answers `change_outdated`. Rows the delivery
 * no longer wants go.
 */
async function storeChanges(
  tx: Db,
  project: ProjectRow,
  wanted: WantedChange[],
  sentAt: Date,
): Promise<void> {
  const rows = await tx.select().from(egrantChanges).where(eq(egrantChanges.projectId, project.id));
  const byTarget = new Map(rows.map((r) => [targetOf(r), r]));
  const keep = new Set<string>();
  for (const w of wanted) {
    const row = byTarget.get(targetOf(w));
    if (w.equal) continue;
    const valueHash = hashOf(w.value);
    if (row) {
      keep.add(row.id);
      if (row.valueHash === valueHash) continue;
      await tx
        .update(egrantChanges)
        .set({
          id: randomUUID(),
          value: w.value,
          valueHash,
          state: 'pending',
          sentAt,
          receivedAt: new Date(),
        })
        .where(eq(egrantChanges.id, row.id));
    } else {
      await tx.insert(egrantChanges).values({
        id: randomUUID(),
        groupId: project.groupId,
        projectId: project.id,
        eventId: w.eventId,
        kind: w.kind,
        eventKey: w.eventKey,
        value: w.value,
        valueHash,
        sentAt,
      });
    }
  }
  const gone = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (gone.length > 0) await tx.delete(egrantChanges).where(inArray(egrantChanges.id, gone));
}

async function pendingCount(tx: Db, projectId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(egrantChanges)
    .where(and(eq(egrantChanges.projectId, projectId), eq(egrantChanges.state, 'pending')));
  return row?.n ?? 0;
}

/**
 * Processes one delivery of the project endpoint for a client, in the caller's transaction (it
 * takes `lockGroupProjects` itself): creates the project with its events on the first one (spec
 * §5.2), links a person's project of the same name, or records the differences as pending
 * changes (§5.4). A `sent_at` older than the last processed one of the project's own eGrant id
 * changes nothing (`stale`). The
 * client's tickets waiting for this eGrant id are linked in every processed delivery.
 */
export async function receiveProjectDelivery(
  tx: Db,
  groupId: string,
  egrantProjectId: string,
  body: EgrantProjectBody,
  by?: AuditActor,
): Promise<DeliveryResult> {
  await lockGroupProjects(tx, groupId);
  const { events, skipped } = parseDeliveredEvents(body.events);
  const sentAt = new Date(body.sent_at);
  let projectId = await findEgrantProject(tx, groupId, egrantProjectId);
  if (projectId === null) {
    const byName = await personProjectByName(tx, groupId, normalizeSearch(body.name));
    if (byName === null) {
      const id = await createFromDelivery(tx, groupId, egrantProjectId, body, events, sentAt, by);
      const linkedTicketIds = await linkWaitingTickets(tx, groupId, egrantProjectId, id);
      return { projectId: id, state: 'created', pending: 0, skipped, linkedTicketIds };
    }
    await tx
      .insert(projectNameKeys)
      .values({ projectId: byName, groupId, kind: 'egrant_id', key: egrantProjectId });
    await tx.update(projects).set({ egrantProjectId }).where(eq(projects.id, byName));
    projectId = byName;
  }
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update');
  if (!project) throw new ProjectNotFoundError();
  // The `sent_at` guard keeps the project's own eGrant id in order. A project merged into it keeps
  // its id as a key only: its deliveries are compared with nothing (they only ever propose).
  const primary = project.egrantProjectId === egrantProjectId;
  if (
    primary &&
    project.egrantSentAt !== null &&
    sentAt.getTime() < project.egrantSentAt.getTime()
  ) {
    const pending = await pendingCount(tx, projectId);
    return { projectId, state: 'stale', pending, skipped: [], linkedTicketIds: [] };
  }
  await storeChanges(tx, project, await diffDelivery(tx, project, body, events), sentAt);
  await tx
    .update(projects)
    .set({ egrantDeliveredAt: new Date(), ...(primary ? { egrantSentAt: sentAt } : {}) })
    .where(eq(projects.id, projectId));
  const linkedTicketIds = await linkWaitingTickets(tx, groupId, egrantProjectId, projectId);
  const pending = await pendingCount(tx, projectId);
  return {
    projectId,
    state: pending > 0 ? 'pending' : 'unchanged',
    pending,
    skipped,
    linkedTicketIds,
  };
}

// ── The inbox: deliveries for an instance no client has yet (spec §5.1) ─────────────────────────

/**
 * Keeps a delivery for an eGrant host no client has (`202 stored`): the latest per project, so an
 * older retry never replaces a newer version.
 */
export async function storeInboxDelivery(
  db: Db,
  host: string,
  egrantProjectId: string,
  body: EgrantProjectBody,
): Promise<void> {
  const sentAt = new Date(body.sent_at);
  await db
    .insert(egrantProjectInbox)
    .values({ instanceHost: host, projectId: egrantProjectId, payload: body, sentAt })
    .onConflictDoUpdate({
      target: [egrantProjectInbox.instanceHost, egrantProjectInbox.projectId],
      set: { payload: body, sentAt, receivedAt: new Date() },
      setWhere: sql`${egrantProjectInbox.sentAt} <= ${sentAt.toISOString()}`,
    });
}

/**
 * Processes the stored deliveries of an eGrant host for a client that now has its URL (the groups
 * service calls it on client create and URL change, in its transaction) and deletes them. Each
 * runs in a savepoint: one that fails stays stored for the next URL change and never blocks the
 * client's save. Returns the projects touched and the tickets linked.
 */
export async function processInboxFor(
  tx: Db,
  groupId: string,
  host: string,
): Promise<{ projectIds: string[]; ticketIds: string[] }> {
  const rows = await tx
    .select()
    .from(egrantProjectInbox)
    .where(eq(egrantProjectInbox.instanceHost, host))
    .orderBy(asc(egrantProjectInbox.sentAt));
  const projectIds: string[] = [];
  const ticketIds: string[] = [];
  for (const row of rows) {
    const body = EgrantProjectBodySchema.safeParse(row.payload);
    try {
      if (body.success) {
        const result = await tx.transaction((sp) =>
          receiveProjectDelivery(
            sp,
            groupId,
            row.projectId,
            body.data,
            egrantActor('projects', `https://${host}`),
          ),
        );
        projectIds.push(result.projectId);
        ticketIds.push(...result.linkedTicketIds);
      }
      await tx
        .delete(egrantProjectInbox)
        .where(
          and(
            eq(egrantProjectInbox.instanceHost, host),
            eq(egrantProjectInbox.projectId, row.projectId),
          ),
        );
    } catch {
      // Kept for the next URL change; the savepoint undid its writes.
    }
  }
  return { projectIds, ticketIds };
}

/** The daily cleanup: stored deliveries older than `olderThan` go. Returns how many. */
export async function dropOldInboxDeliveries(db: Db, olderThan: Date): Promise<number> {
  const rows = await db
    .delete(egrantProjectInbox)
    .where(lt(egrantProjectInbox.receivedAt, olderThan))
    .returning({ projectId: egrantProjectInbox.projectId });
  return rows.length;
}

// ── Review (spec §5.4, decision 6d) ─────────────────────────────────────────────────────────────

type IncomingEvent = { name: string; occursOn: string; description: string };

const KIND_ORDER: EgrantChangeKind[] = [
  'project_name',
  'project_description',
  'event_name',
  'event_date',
  'event_description',
  'event_add',
  'event_remove',
];

/**
 * "Maybe the same event": each pending removal next to the pending addition nearest by date, one
 * to one (an event renamed and redated at once arrives as such a pair).
 */
function maybeSamePairs(changes: EgrantChangeDto[]): EgrantChangeList['maybeSame'] {
  const dateOf = (c: EgrantChangeDto) => {
    const v = (c.kind === 'event_add' ? c.incoming : c.current) as IncomingEvent | null;
    return v ? Date.parse(v.occursOn) : 0;
  };
  const adds = changes.filter((c) => c.kind === 'event_add');
  const result: EgrantChangeList['maybeSame'] = [];
  for (const remove of changes.filter((c) => c.kind === 'event_remove')) {
    let best = -1;
    adds.forEach((add, i) => {
      const d = Math.abs(dateOf(add) - dateOf(remove));
      if (best === -1 || d < Math.abs(dateOf(adds[best]!) - dateOf(remove))) best = i;
    });
    if (best === -1) break;
    result.push({ addId: adds[best]!.id, removeId: remove.id });
    adds.splice(best, 1);
  }
  return result;
}

/** The project's pending changes with the current values, for "Changes from eGrant". */
export async function listEgrantChanges(db: Db, projectId: string): Promise<EgrantChangeList> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new ProjectNotFoundError();
  const rows = await db
    .select({ change: egrantChanges, event: projectEvents })
    .from(egrantChanges)
    .leftJoin(projectEvents, eq(projectEvents.id, egrantChanges.eventId))
    .where(and(eq(egrantChanges.projectId, projectId), eq(egrantChanges.state, 'pending')));
  const toDto = ({ change: c, event: e }: (typeof rows)[number]): EgrantChangeDto => {
    const asEvent = (x: EventRow): IncomingEvent => ({
      name: x.name,
      occursOn: x.occursOn,
      description: x.description,
    });
    let current: EgrantChangeDto['current'] = null;
    let incoming: EgrantChangeDto['incoming'] = null;
    if (c.kind === 'project_name') current = project.name;
    if (c.kind === 'project_description') current = project.description;
    if (c.kind === 'event_name') current = e?.name ?? null;
    if (c.kind === 'event_date') current = e?.occursOn ?? null;
    if (c.kind === 'event_description') current = e?.description ?? null;
    if (c.kind === 'event_remove') current = e ? asEvent(e) : null;
    if (c.kind === 'event_add') incoming = c.value as IncomingEvent;
    else if (c.kind !== 'event_remove') incoming = c.value as string;
    return {
      id: c.id,
      kind: c.kind,
      eventId: c.eventId,
      current,
      incoming,
      sentAt: c.sentAt.toISOString(),
      receivedAt: c.receivedAt.toISOString(),
    };
  };
  const sortDate = (r: (typeof rows)[number]) =>
    r.event?.occursOn ?? (r.change.value as Partial<IncomingEvent>).occursOn ?? '';
  const sorted = [...rows].sort((a, b) => {
    const projectFirst =
      Number(a.change.kind.startsWith('event')) - Number(b.change.kind.startsWith('event'));
    return (
      projectFirst ||
      sortDate(a).localeCompare(sortDate(b)) ||
      (a.change.eventId ?? a.change.eventKey ?? '').localeCompare(
        b.change.eventId ?? b.change.eventKey ?? '',
      ) ||
      KIND_ORDER.indexOf(a.change.kind) - KIND_ORDER.indexOf(b.change.kind)
    );
  });
  const changes = sorted.map(toDto);
  return { changes, maybeSame: maybeSamePairs(changes) };
}

/** The kinds of the pending changes with these ids in the project (the route checks the rights). */
export async function changeKinds(
  db: Db,
  projectId: string,
  ids: readonly string[],
): Promise<EgrantChangeKind[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ kind: egrantChanges.kind })
    .from(egrantChanges)
    .where(and(eq(egrantChanges.projectId, projectId), inArray(egrantChanges.id, [...ids])));
  return rows.map((r) => r.kind);
}

/** Applies one accepted change in the review's transaction; returns files to delete after it. */
async function applyChange(
  tx: Db,
  project: ProjectRow,
  change: ChangeRow,
  current: { name: string; description: string },
  audit: AuditEntry[],
): Promise<string[]> {
  const now = sql`now()`;
  switch (change.kind) {
    case 'project_name': {
      const name = change.value as string;
      // The old name stays as an alias (spec §5.6); another project's name is 409.
      await claimNameKey(tx, project.groupId, project.id, normalizeSearch(name));
      current.name = name;
      return [];
    }
    case 'project_description':
      current.description = change.value as string;
      return [];
    case 'event_name':
    case 'event_date':
    case 'event_description': {
      const value = change.value as string;
      const set =
        change.kind === 'event_name'
          ? { name: value, nameKey: normalizeSearch(value) }
          : change.kind === 'event_date'
            ? { occursOn: value }
            : { description: value };
      const [before] = await tx
        .select()
        .from(projectEvents)
        .where(eq(projectEvents.id, change.eventId!));
      const [after] = await tx
        .update(projectEvents)
        .set({ ...set, updatedAt: now })
        .where(eq(projectEvents.id, change.eventId!))
        .returning();
      if (before && after) {
        const changes = diffFields('project_event', eventValues(before), eventValues(after));
        if (hasChanges(changes)) audit.push(eventEntry(after, 'updated', changes));
      }
      return [];
    }
    case 'event_add': {
      const event = change.value as IncomingEvent;
      const nameKey = normalizeSearch(event.name);
      const eventId = randomUUID();
      audit.push(
        eventEntry(
          { id: eventId, groupId: project.groupId, name: event.name },
          'created',
          diffFields('project_event', null, eventValues(event)),
        ),
      );
      await tx.insert(projectEvents).values({
        id: eventId,
        projectId: project.id,
        groupId: project.groupId,
        name: event.name,
        nameKey,
        description: event.description,
        occursOn: event.occursOn,
        source: 'egrant',
        egrantNameKey: nameKey,
        egrantDate: event.occursOn,
      });
      return [];
    }
    case 'event_remove': {
      // Its tasks and tickets keep the project and lose the event (the FK), as on a delete.
      const fileIds = (
        await tx
          .select({ fileId: projectAttachments.fileId })
          .from(projectAttachments)
          .where(eq(projectAttachments.eventId, change.eventId!))
      ).map((r) => r.fileId);
      const gone = await tx
        .delete(projectEvents)
        .where(eq(projectEvents.id, change.eventId!))
        .returning();
      for (const e of gone) {
        audit.push(eventEntry(e, 'deleted', diffFields('project_event', eventValues(e), null)));
      }
      await detachFiles(tx, fileIds);
      return fileIds;
    }
  }
}

/**
 * Applies the accepted pending changes of a project and marks the dismissed ones, in one
 * transaction ("Save choices"). Every id must name a pending change of this project as it is
 * now, else nothing is applied (`ChangeOutdatedError`). Removals go last.
 */
export async function reviewEgrantChanges(
  deps: { db: Db; storage: Storage },
  projectId: string,
  review: EgrantReviewBody,
  by?: AuditActor,
): Promise<ProjectDto> {
  const { db } = deps;
  const groupId = await projectGroupId(db, projectId);
  if (groupId === null) throw new ProjectNotFoundError();
  const fileIds = await db.transaction(async (tx) => {
    await lockGroupProjects(tx, groupId);
    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!project) throw new ProjectNotFoundError();
    const ids = [...new Set([...review.accept, ...review.dismiss])];
    const rows = await tx
      .select()
      .from(egrantChanges)
      .where(
        and(
          eq(egrantChanges.projectId, projectId),
          eq(egrantChanges.state, 'pending'),
          inArray(egrantChanges.id, ids),
        ),
      );
    if (rows.length !== ids.length) throw new ChangeOutdatedError();
    const accepted = rows
      .filter((r) => review.accept.includes(r.id))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const current = { name: project.name, description: project.description };
    const dropped: string[] = [];
    // The admin who accepts eGrant's changes is their author (spec §3.1).
    const audit: AuditEntry[] = [];
    for (const change of accepted)
      dropped.push(...(await applyChange(tx, project, change, current, audit)));
    if (accepted.length > 0) {
      // A removal's own rows went with its event already.
      await tx.delete(egrantChanges).where(
        inArray(
          egrantChanges.id,
          accepted.map((r) => r.id),
        ),
      );
    }
    if (review.dismiss.length > 0) {
      await tx
        .update(egrantChanges)
        .set({ state: 'dismissed' })
        .where(inArray(egrantChanges.id, review.dismiss));
    }
    await tx
      .update(projects)
      .set({
        name: current.name,
        nameKey: normalizeSearch(current.name),
        description: current.description,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, projectId));
    const projectChanges = diffFields('project', projectValues(project), projectValues(current));
    if (hasChanges(projectChanges)) {
      audit.unshift(projectEntry({ ...project, name: current.name }, 'updated', projectChanges));
    }
    if (by) await recordAudit(tx, by, audit);
    return dropped;
  });
  await deleteDetachedFiles(deps, fileIds).catch(() => undefined);
  return getProject(db, projectId);
}
