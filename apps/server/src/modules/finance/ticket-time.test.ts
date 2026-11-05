import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { FinanceEvents, type SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { insertTask } from '../../../test/tasks.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { updateTimeEntry } from './manual-entries.js';
import { financeTimeEntries } from './schema.js';
import {
  countMyTimeRequests,
  listMyTimeRequests,
  myTimeRequests,
  onTaskCompleted,
  writeTaskTime,
} from './task-time.js';
import {
  getTicketTime,
  keepTicketTime,
  onTicketAssigneesRemoved,
  onTicketDeleting,
  onTicketDone,
  onTicketMoved,
  onTicketReopened,
  requestOwnTicketTime,
  requestTicketTimeReview,
  writeTicketTime,
  type TicketTimeSubject,
} from './ticket-time.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const email = () => `${randomUUID()}@example.com`;
const admin = async (name: string, finance = false): Promise<SessionUser> => {
  const row = await addAdmin(db, { email: email(), name });
  return { id: row.id, email: row.email, name, role: 'admin', finance };
};
async function client() {
  const id = randomUUID();
  await db.insert(user).values({ id, email: email(), name: 'Client', role: 'client' });
  return id;
}
const newGroup = async () =>
  (
    await createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().slice(0, 8)}.egrant.sk`,
    })
  ).id;

async function newTicket(groupId: string | null) {
  const id = randomUUID();
  const [row] = await db
    .insert(tickets)
    .values({
      id,
      groupId,
      source: 'manual',
      subject: 'Login fails',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ number: tickets.number });
  return { id, number: row!.number };
}

async function setup(withClient = true) {
  const groupId = withClient ? await newGroup() : null;
  const a = await admin('Eva');
  const b = await admin('Ján');
  const c = await client();
  const ticket = await newTicket(groupId);
  return { groupId, a, b, c, ticket };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const doneEvent = (s: Setup, actorId: string, linkedTaskIds: string[] = []) => ({
  ticketId: s.ticket.id,
  groupId: s.groupId,
  number: s.ticket.number,
  title: 'Login fails',
  doneAt: new Date('2026-10-17T08:00:00Z'),
  actorId,
  actorName: 'Actor',
  assigneeIds: [s.a.id, s.b.id, s.c],
  linkedTaskIds,
});
const resolved = (s: Setup, actorId: string, linkedTaskIds: string[] = []) =>
  onTicketDone(db, doneEvent(s, actorId, linkedTaskIds));
const reviewed = (s: Setup, actorId: string) => requestTicketTimeReview(db, doneEvent(s, actorId));

const entriesOf = (ticketId: string) =>
  db.select().from(financeTimeEntries).where(eq(financeTimeEntries.ticketId, ticketId));

const subject = (s: Setup, over: Partial<TicketTimeSubject> = {}): TicketTimeSubject => ({
  ticketId: s.ticket.id,
  groupId: s.groupId,
  number: s.ticket.number,
  title: 'Login fails',
  resolvedAt: new Date('2026-10-17T08:00:00Z'),
  assigneeIds: [s.a.id, s.b.id, s.c],
  linkedTasks: [],
  ...over,
});

const fakeIo = () => {
  const emit = vi.fn();
  return { emit, io: { to: () => ({ emit }) } as never };
};
const entryOf = async (s: Setup, userId: string) =>
  (await entriesOf(s.ticket.id)).find((r) => r.userId === userId)!;
const eventsOf = async (s: Setup, kind: string) =>
  (
    await db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.kind, kind as never))
  )
    .filter((e) => (e.payload as { ticketId: string }).ticketId === s.ticket.id)
    .map((e) => e.userId);

describe('onTicketDone', () => {
  it('asks the acting admin riešiteľ and notifies the other admin riešitelia, never a client', async () => {
    const s = await setup();
    const result = await resolved(s, s.a.id);
    expect(result).toMatchObject({ askActor: true, notified: [s.b.id], linkedTasksLogged: false });
    const rows = await entriesOf(s.ticket.id);
    expect(rows.map((r) => r.userId).sort()).toEqual([s.a.id, s.b.id].sort());
    expect(rows[0]).toMatchObject({
      source: 'ticket',
      minutes: null,
      workedOn: '2026-10-17',
      title: `#${s.ticket.number} Login fails`,
    });
    const events = await db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.kind, 'ticket.time_missing'));
    const mine = events.filter((e) => (e.payload as { ticketId: string }).ticketId === s.ticket.id);
    expect(mine.map((e) => e.userId)).toEqual([s.b.id]);
    expect(mine[0]!.payload).toMatchObject({ number: s.ticket.number, title: 'Login fails' });
    const requests = await listMyTimeRequests(db, s.b.id, 20);
    expect(requests.map((r) => [r.kind, r.ticketId, r.taskId])).toEqual([
      ['ticket', s.ticket.id, null],
    ]);
  });

  it('a ticket without a client asks too; its entries have no client (decision 24)', async () => {
    const s = await setup(false);
    const result = await resolved(s, s.a.id);
    expect(result).toMatchObject({ askActor: true, notified: [s.b.id], changed: true });
    const rows = await entriesOf(s.ticket.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.groupId).toBeNull();
    const requests = await listMyTimeRequests(db, s.b.id, 20);
    expect(requests).toMatchObject([{ kind: 'ticket', ticketId: s.ticket.id, groupId: null }]);
    // The ticket gets a client: its entries move to it.
    const client = await newGroup();
    await onTicketMoved(db, s.ticket.id, client);
    for (const row of await entriesOf(s.ticket.id)) expect(row.groupId).toBe(client);
  });

  it('a task entry may not lack a client (the CHECK; a ticket or manual one may, migration 0041)', async () => {
    const a = await admin('Eva');
    await expect(
      db.insert(financeTimeEntries).values({
        id: randomUUID(),
        groupId: null,
        userId: a.id,
        source: 'task',
        title: 'Task',
        createdBy: a.id,
        updatedBy: a.id,
      }),
    ).rejects.toThrow();
  });

  it('reports linked tasks with logged time (option b)', async () => {
    const s = await setup();
    const taskId = await insertTask(db, { groupId: s.groupId!, createdBy: s.a.id });
    expect((await resolved(s, s.a.id, [taskId])).linkedTasksLogged).toBe(false);
    await onTicketReopened(db, s.ticket.id);
    await onTaskCompleted(db, {
      taskId,
      groupId: s.groupId!,
      title: 'T',
      completedAt: new Date(),
      actorId: s.b.id,
      actorName: 'B',
      assigneeIds: [s.b.id],
      sourceTicketId: s.ticket.id,
    });
    const task = {
      taskId,
      groupId: s.groupId!,
      title: 'T',
      completedAt: new Date(),
      sourceTicketId: s.ticket.id,
    };
    await writeTaskTime(db, s.b.id, task, 60);
    expect((await resolved(s, s.a.id, [taskId])).linkedTasksLogged).toBe(true);
  });

  it('reopen, removal and delete drop requests only', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    expect(await onTicketReopened(db, s.ticket.id)).toEqual([s.b.id]);
    await resolved(s, s.a.id);
    expect(await onTicketAssigneesRemoved(db, s.ticket.id, [s.a.id, s.b.id])).toEqual([s.b.id]);
    await resolved(s, s.a.id);
    expect(await onTicketDeleting(db, s.ticket.id)).toEqual([s.b.id]);
    await db.delete(tickets).where(eq(tickets.id, s.ticket.id));
    const kept = await db
      .select()
      .from(financeTimeEntries)
      .where(eq(financeTimeEntries.userId, s.a.id));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ ticketId: null, minutes: 30, source: 'ticket' });
  });

  it('entries move with a ticket that changes client', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    const other = await newGroup();
    await onTicketMoved(db, s.ticket.id, other);
    for (const row of await entriesOf(s.ticket.id)) expect(row.groupId).toBe(other);
  });
});

describe('requestTicketTimeReview', () => {
  it('marks filled entries and tells everyone but the actor; requests stay as they are', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    const result = await reviewed(s, s.a.id);
    expect(result).toMatchObject({ askActor: true, changed: true, users: [s.a.id] });
    expect((await entryOf(s, s.a.id)).reviewRequestedAt).not.toBeNull();
    expect(await entryOf(s, s.b.id)).toMatchObject({ minutes: null, reviewRequestedAt: null });
    expect(await eventsOf(s, 'ticket.time_review')).toEqual([]);

    await writeTicketTime(db, s.b.id, subject(s), { minutes: 10 });
    const byOther = await reviewed(s, s.a.id);
    expect(byOther.eventIds).toHaveLength(1);
    expect(await eventsOf(s, 'ticket.time_review')).toEqual([s.b.id]);
  });

  it('the dialog goes to an admin riešiteľ whatever they have: a review or an open request', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await writeTicketTime(db, s.b.id, subject(s), { minutes: 10 });
    expect((await reviewed(s, s.a.id)).askActor).toBe(true);
    expect((await reviewed(s, s.b.id)).askActor).toBe(true);
  });

  it('a request just inserted gets the dialog too', async () => {
    const s = await setup();
    expect((await reviewed(s, s.a.id)).askActor).toBe(true);
  });

  it('a client or an admin who is no riešiteľ gets no dialog', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    const outsider = await admin('Outsider');
    expect((await reviewed(s, s.c)).askActor).toBe(false);
    expect((await reviewed(s, outsider.id)).askActor).toBe(false);
  });

  it('covers an answer of 0 minutes (the linked tasks) like any filled time', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { coveredByTasks: true });
    expect((await reviewed(s, s.a.id)).askActor).toBe(true);
  });

  it('a filled entry without a day gets one, so a review row always has a day', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s, { resolvedAt: null }), { minutes: 30 });
    expect((await entryOf(s, s.a.id)).workedOn).toBeNull();
    await reviewed(s, s.b.id);
    expect(await entryOf(s, s.a.id)).toMatchObject({ workedOn: '2026-10-17' });
    expect(await listMyTimeRequests(db, s.a.id, 20)).toMatchObject([
      { review: true, workedOn: '2026-10-17' },
    ]);
  });

  it('never moves the day of an entry that has one', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await requestTicketTimeReview(db, {
      ...doneEvent(s, s.b.id),
      doneAt: new Date('2026-11-01T08:00:00Z'),
    });
    expect(await entryOf(s, s.a.id)).toMatchObject({ workedOn: '2026-10-17' });
  });

  it('an admin riešiteľ with no entry at all gets the ordinary request', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    const result = await reviewed(s, s.a.id);
    expect(result.users.sort()).toEqual([s.a.id, s.b.id].sort());
    expect(await entryOf(s, s.b.id)).toMatchObject({ minutes: null, workedOn: '2026-10-17' });
    expect(await eventsOf(s, 'ticket.time_missing')).toEqual([s.b.id]);
    expect(await eventsOf(s, 'ticket.time_review')).toEqual([]);
  });

  it('a riešiteľ with an open request is not told again', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await reviewed(s, s.a.id);
    expect(await eventsOf(s, 'ticket.time_missing')).toEqual([s.b.id]);
  });

  it('a review is a row but never counts as missing time', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await reviewed(s, s.a.id);
    const mine = await myTimeRequests(db, s.a.id, 20);
    expect(mine.total).toBe(0);
    expect(mine.rows).toMatchObject([
      { kind: 'ticket', ticketId: s.ticket.id, review: true, workedOn: '2026-10-17' },
    ]);
    expect(await countMyTimeRequests(db, s.a.id)).toBe(0);
    // Both kinds together: the count stays on the open request.
    const other = await myTimeRequests(db, s.b.id, 20);
    expect(other.total).toBe(1);
    expect(other.rows).toMatchObject([{ review: false }]);
  });

  it('keep clears the mark and leaves the rest; it touches only the caller', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await writeTicketTime(db, s.b.id, subject(s), { minutes: 10 });
    await reviewed(s, s.a.id);
    await keepTicketTime(db, s.a.id, s.ticket.id);
    expect(await entryOf(s, s.a.id)).toMatchObject({ minutes: 30, reviewRequestedAt: null });
    expect((await entryOf(s, s.b.id)).reviewRequestedAt).not.toBeNull();
  });

  it('a save clears it', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await reviewed(s, s.a.id);
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 31 });
    expect(await entryOf(s, s.a.id)).toMatchObject({ minutes: 31, reviewRequestedAt: null });
  });

  it('reopening, losing the riešiteľ or deleting the ticket ends the review', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await reviewed(s, s.a.id);
    expect(await onTicketReopened(db, s.ticket.id)).toContain(s.a.id);
    expect((await entryOf(s, s.a.id)).reviewRequestedAt).toBeNull();

    await reviewed(s, s.a.id);
    expect(await onTicketAssigneesRemoved(db, s.ticket.id, [s.a.id])).toEqual([s.a.id]);
    expect(await entryOf(s, s.a.id)).toMatchObject({ minutes: 30, reviewRequestedAt: null });
  });

  it('open requests come before reviews, so a review never hides one behind the limit', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await reviewed(s, s.a.id);
    const later = { ...s, ticket: await newTicket(s.groupId) };
    await onTicketDone(db, {
      ...doneEvent(later, s.b.id),
      doneAt: new Date('2026-11-01T08:00:00Z'),
    });
    const { rows, total } = await myTimeRequests(db, s.a.id, 1);
    expect(total).toBe(1);
    expect(rows).toMatchObject([{ ticketId: later.ticket.id, review: false }]);
    expect((await myTimeRequests(db, s.a.id, 2)).rows.map((r) => r.review)).toEqual([false, true]);
  });

  it('a work-log edit of your own entry answers the review and tells your dashboard', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await reviewed(s, s.a.id);
    const { id } = await entryOf(s, s.a.id);
    const { io, emit } = fakeIo();
    await updateTimeEntry({ db, io }, s.a, id, { minutes: 40 });
    expect(await entryOf(s, s.a.id)).toMatchObject({ minutes: 40, reviewRequestedAt: null });
    expect(emit).toHaveBeenCalledWith(FinanceEvents.timeRequests, { count: 0 });
  });

  it("a finance admin editing someone else's entry leaves the review", async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    await reviewed(s, s.a.id);
    const { id } = await entryOf(s, s.a.id);
    const { io, emit } = fakeIo();
    await updateTimeEntry({ db, io }, await admin('Fin', true), id, { minutes: 40 });
    expect((await entryOf(s, s.a.id)).reviewRequestedAt).not.toBeNull();
    expect(emit).not.toHaveBeenCalledWith(FinanceEvents.timeRequests, expect.anything());
  });
});

describe('requestOwnTicketTime', () => {
  const own = (s: Setup, actorId: string) => requestOwnTicketTime(db, doneEvent(s, actorId));

  it("keeps or inserts only the actor's request and tells nobody", async () => {
    const s = await setup();
    expect(await own(s, s.a.id)).toMatchObject({ askActor: true, users: [s.a.id], eventIds: [] });
    expect((await entriesOf(s.ticket.id)).map((r) => r.userId)).toEqual([s.a.id]);
    expect(await own(s, s.a.id)).toMatchObject({ askActor: true, users: [], changed: false });
    expect(await eventsOf(s, 'ticket.time_missing')).toEqual([]);
  });

  it('filled time, a client or an admin who is no riešiteľ: nothing', async () => {
    const s = await setup();
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 30 });
    expect((await own(s, s.a.id)).askActor).toBe(false);
    expect((await own(s, s.c)).askActor).toBe(false);
    expect((await own(s, (await admin('Outsider')).id)).askActor).toBe(false);
    expect(await entriesOf(s.ticket.id)).toHaveLength(1);
  });
});

describe('writeTicketTime and getTicketTime', () => {
  it('(b) stores 0 minutes covered by the tasks; adding hours turns it into (a)', async () => {
    const s = await setup();
    await resolved(s, s.a.id);
    await writeTicketTime(db, s.a.id, subject(s), { coveredByTasks: true });
    let mine = (await getTicketTime(db, s.a, subject(s))).mine;
    expect(mine).toEqual({ minutes: 0, requested: false, coveredByTasks: true });
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 45 });
    mine = (await getTicketTime(db, s.a, subject(s))).mine;
    expect(mine).toEqual({ minutes: 45, requested: false, coveredByTasks: false });
    const [row] = (await entriesOf(s.ticket.id)).filter((r) => r.userId === s.a.id);
    expect(row).toMatchObject({ workedOn: '2026-10-17' });
  });

  it('a non-finance admin sees only their own time; a finance admin sees every riešiteľ', async () => {
    const s = await setup();
    const taskId = await insertTask(db, { groupId: s.groupId!, createdBy: s.a.id });
    const task = {
      taskId,
      groupId: s.groupId!,
      title: 'T',
      completedAt: new Date(),
      sourceTicketId: s.ticket.id,
    };
    await writeTaskTime(db, s.b.id, task, 60);
    await resolved(s, s.a.id, [taskId]);
    const linkedTasks = [{ taskId, title: 'T', done: true }];
    const forA = await getTicketTime(db, s.a, subject(s, { linkedTasks }));
    expect(forA.assignees).toBeUndefined();
    expect(forA.mine).toEqual({ minutes: null, requested: true, coveredByTasks: false });
    expect(forA.linkedTasks).toEqual([{ taskId, title: 'T', done: true, mine: null }]);
    expect(forA.linkedTasksLogged).toBe(true);
    const forB = await getTicketTime(db, s.b, subject(s, { linkedTasks }));
    expect(forB.linkedTasks[0]!.mine).toBe(60);

    const fin = await admin('Fin', true);
    const forFin = await getTicketTime(db, fin, subject(s, { linkedTasks }));
    expect(forFin.mine).toBeNull();
    expect(forFin.assignees?.map((x) => [x.name, x.requested])).toEqual([
      ['Eva', true],
      ['Ján', true],
    ]);
  });

  it('a ticket without a client: own time like any ticket (decision 24)', async () => {
    const s = await setup(false);
    await writeTicketTime(db, s.a.id, subject(s), { minutes: 20 });
    expect((await getTicketTime(db, s.a, subject(s))).mine).toEqual({
      minutes: 20,
      requested: false,
      coveredByTasks: false,
    });
  });
});
