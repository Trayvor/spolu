import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { insertTask } from '../../../test/tasks.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { financeTimeEntries } from './schema.js';
import { listMyTimeRequests, onTaskCompleted, writeTaskTime } from './task-time.js';
import {
  getTicketTime,
  onTicketAssigneesRemoved,
  onTicketDeleting,
  onTicketMoved,
  onTicketReopened,
  onTicketResolved,
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
const resolved = (s: Setup, actorId: string, linkedTaskIds: string[] = []) =>
  onTicketResolved(db, {
    ticketId: s.ticket.id,
    groupId: s.groupId,
    number: s.ticket.number,
    title: 'Login fails',
    resolvedAt: new Date('2026-10-17T08:00:00Z'),
    actorId,
    actorName: 'Actor',
    assigneeIds: [s.a.id, s.b.id, s.c],
    linkedTaskIds,
  });

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

describe('onTicketResolved', () => {
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
