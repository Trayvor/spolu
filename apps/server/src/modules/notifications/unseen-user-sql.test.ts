import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { newAdmin, newGroup, newTask } from '../home/test-fixtures.js';
import { tickets } from '../tickets/schema.js';
import { recordNotifications } from './service.js';
import { unseenTaskIdsSql, unseenTicketIdsSql } from './unseen.js';

/**
 * 2026-10-19 (admin workload card): the unseen fragments take an SQL expression for the user, so
 * one statement runs them per admin in a lateral join. A string user stays a bound parameter.
 */
const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const ids = async (query: ReturnType<typeof sql>, column: string) =>
  [...(await db.execute<Record<string, string>>(query))].map((r) => r[column]!);

async function newTicket(groupId: string) {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tickets).values({
    id,
    groupId,
    status: 'new',
    source: 'manual',
    subject: 'T',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe('unseen fragments for an SQL user', () => {
  it('unseenTaskIdsSql gives the same tasks for a string user and an SQL user', async () => {
    const group = await newGroup(db, 'Unseen SQL user');
    const admin = await newAdmin(db, 'Ada');
    const taskId = await newTask(db, { groupId: group.id, createdBy: admin.id });
    await newTask(db, { groupId: group.id, createdBy: admin.id });
    await recordNotifications(db, {
      kind: 'task.assigned',
      groupId: group.id,
      recipients: [admin.id],
      payload: { taskId, groupId: group.id },
    });
    const byString = await ids(
      sql`select task_id from (${unseenTaskIdsSql(admin.id)}) x`,
      'task_id',
    );
    const bySql = await ids(
      sql`select x.task_id from "user" wa
        cross join lateral (${unseenTaskIdsSql(sql`wa.id`)}) x where wa.id = ${admin.id}`,
      'task_id',
    );
    expect(byString).toEqual([taskId]);
    expect(bySql).toEqual([taskId]);
  });

  it('unseenTicketIdsSql gives the same tickets for a string user and an SQL user', async () => {
    const group = await newGroup(db, 'Unseen SQL ticket');
    const admin = await newAdmin(db, 'Ada');
    const ticketId = await newTicket(group.id);
    await newTicket(group.id);
    await recordNotifications(db, {
      kind: 'ticket.status',
      groupId: group.id,
      recipients: [admin.id],
      payload: { ticketId },
    });
    const byString = await ids(
      sql`select ticket_id from (${unseenTicketIdsSql(admin.id)}) x`,
      'ticket_id',
    );
    const bySql = await ids(
      sql`select x.ticket_id from "user" wa
        cross join lateral (${unseenTicketIdsSql(sql`wa.id`)}) x where wa.id = ${admin.id}`,
      'ticket_id',
    );
    expect(byString).toEqual([ticketId]);
    expect(bySql).toEqual([ticketId]);
  });

  it("a lateral run over two admins keeps each admin's own unseen items", async () => {
    const group = await newGroup(db, 'Unseen SQL two');
    const a = await newAdmin(db, 'Ada');
    const b = await newAdmin(db, 'Bea');
    const taskId = await newTask(db, { groupId: group.id, createdBy: a.id });
    await recordNotifications(db, {
      kind: 'task.assigned',
      groupId: group.id,
      recipients: [a.id],
      payload: { taskId, groupId: group.id },
    });
    const rows = [
      ...(await db.execute<{ user_id: string; task_id: string }>(sql`
        select wa.id as user_id, x.task_id from "user" wa
        cross join lateral (${unseenTaskIdsSql(sql`wa.id`)}) x
        where wa.id in (${a.id}, ${b.id})
      `)),
    ];
    expect(rows).toEqual([{ user_id: a.id, task_id: taskId }]);
  });
});
