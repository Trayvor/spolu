import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { reminderSets } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { financeItems, financeRates, financeTimeEntries } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const email = () => `${randomUUID()}@example.com`;
const newGroup = () =>
  createGroup(db, {
    name: 'Fin',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });

/** The CHECK a failed insert broke (postgres.js wraps the error in drizzle's). */
async function violated(write: Promise<unknown>): Promise<string | undefined> {
  try {
    await write;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name ?? (error as { constraint_name?: string }).constraint_name;
  }
}

describe('finance migration CHECKs', () => {
  it('only an admin can hold the finance right', async () => {
    const id = randomUUID();
    await db.insert(user).values({ id, email: email(), name: 'C', role: 'client' });
    expect(
      await violated(db.update(user).set({ financeAccessAt: new Date() }).where(eq(user.id, id))),
    ).toBe('user_finance_access_check');
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    await db.update(user).set({ financeAccessAt: new Date() }).where(eq(user.id, admin.id));
  });

  it('a contract needs its amount, currency and period; other types none of them', async () => {
    const g = await newGroup();
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const base = { groupId: g.id, title: 'T', createdBy: admin.id };
    expect(
      await violated(
        db.insert(financeItems).values({ ...base, id: randomUUID(), type: 'contract' }),
      ),
    ).toBe('finance_items_contract_check');
    const contract = {
      ...base,
      type: 'contract' as const,
      amountMinor: 1_200_000,
      currency: 'EUR' as const,
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    };
    await db.insert(financeItems).values({ ...contract, id: randomUUID() });
    expect(
      await violated(
        db.insert(financeItems).values({ ...contract, id: randomUUID(), endsOn: '2025-12-31' }),
      ),
    ).toBe('finance_items_period_check');
    expect(
      await violated(
        db.insert(financeItems).values({ ...contract, id: randomUUID(), amountMinor: -1 }),
      ),
    ).toBe('finance_items_amount_check');
    expect(
      await violated(
        db
          .insert(financeItems)
          .values({ ...base, id: randomUUID(), type: 'note', amountMinor: 5, currency: 'EUR' }),
      ),
    ).toBe('finance_items_contract_check');
    await db.insert(financeItems).values({ ...base, id: randomUUID(), type: 'document' });
  });

  it('a manual entry needs minutes and a day and has no subject; a task entry needs a title', async () => {
    const g = await newGroup();
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const base = { groupId: g.id, userId: admin.id, createdBy: admin.id, updatedBy: admin.id };
    expect(
      await violated(
        db
          .insert(financeTimeEntries)
          .values({ ...base, id: randomUUID(), source: 'manual', workedOn: '2026-10-01' }),
      ),
    ).toBe('finance_time_entries_manual_check');
    expect(
      await violated(
        db
          .insert(financeTimeEntries)
          .values({ ...base, id: randomUUID(), source: 'manual', minutes: 30 }),
      ),
    ).toBe('finance_time_entries_manual_check');
    await db.insert(financeTimeEntries).values({
      ...base,
      id: randomUUID(),
      source: 'manual',
      minutes: 0,
      workedOn: '2026-10-01',
    });
    expect(
      await violated(
        db.insert(financeTimeEntries).values({ ...base, id: randomUUID(), source: 'task' }),
      ),
    ).toBe('finance_time_entries_title_check');
    expect(
      await violated(
        db.insert(financeTimeEntries).values({
          ...base,
          id: randomUUID(),
          source: 'manual',
          minutes: 6001,
          workedOn: '2026-10-01',
        }),
      ),
    ).toBe('finance_time_entries_minutes_check');
  });

  it('a ticket entry has no task; option (b) "covered by the linked tasks" is 0 minutes of a ticket', async () => {
    const g = await newGroup();
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const ticketId = randomUUID();
    await db.execute(
      sql`insert into tickets (id, group_id, source, subject, body, created_at, updated_at) values (${ticketId}, ${g.id}, 'manual', 'T', '', now(), now())`,
    );
    const base = {
      groupId: g.id,
      userId: admin.id,
      createdBy: admin.id,
      updatedBy: admin.id,
      title: 'T',
      workedOn: '2026-10-01',
    };
    await db.insert(financeTimeEntries).values({
      ...base,
      id: randomUUID(),
      source: 'ticket',
      ticketId,
      minutes: 0,
      coveredByTasks: true,
    });
    // One entry per admin per ticket.
    expect(
      await violated(
        db
          .insert(financeTimeEntries)
          .values({ ...base, id: randomUUID(), source: 'ticket', ticketId, minutes: 30 }),
      ),
    ).toBe('finance_time_entries_ticket_user_unique');
    expect(
      await violated(
        db.insert(financeTimeEntries).values({
          ...base,
          id: randomUUID(),
          source: 'ticket',
          ticketId: null,
          minutes: 30,
          coveredByTasks: true,
        }),
      ),
    ).toBe('finance_time_entries_covered_check');
    expect(
      await violated(
        db.insert(financeTimeEntries).values({
          ...base,
          id: randomUUID(),
          source: 'task',
          minutes: 0,
          coveredByTasks: true,
        }),
      ),
    ).toBe('finance_time_entries_covered_check');
    expect(
      await violated(
        db
          .insert(financeTimeEntries)
          .values({ ...base, id: randomUUID(), source: 'task', ticketId, minutes: 5 }),
      ),
    ).toBe('finance_time_entries_subject_check');
    expect(
      await violated(
        db.insert(financeTimeEntries).values({
          ...base,
          id: randomUUID(),
          source: 'manual',
          minutes: 5,
          linkedTicketId: ticketId,
        }),
      ),
    ).toBe('finance_time_entries_subject_check');
    // A task entry of a task made from the ticket belongs to its unit.
    await db.insert(financeTimeEntries).values({
      ...base,
      id: randomUUID(),
      source: 'task',
      linkedTicketId: ticketId,
      minutes: 45,
    });
    // Deleting the ticket keeps the time, without the ticket.
    await db.execute(sql`delete from tickets where id = ${ticketId}`);
    const kept = await db
      .select()
      .from(financeTimeEntries)
      .where(eq(financeTimeEntries.groupId, g.id));
    expect(kept.map((e) => [e.source, e.ticketId, e.linkedTicketId, e.minutes]).sort()).toEqual([
      ['task', null, null, 45],
      ['ticket', null, null, 0],
    ]);
  });

  it('one "from the start" rate per admin, and rates are positive EUR', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const base = { userId: admin.id, createdBy: admin.id, rateMinor: 4000 };
    await db.insert(financeRates).values({ ...base, id: randomUUID(), effectiveFrom: null });
    expect(
      await violated(
        db.insert(financeRates).values({ ...base, id: randomUUID(), effectiveFrom: null }),
      ),
    ).toBe('finance_rates_user_from_unique');
    expect(
      await violated(
        db
          .insert(financeRates)
          .values({ ...base, id: randomUUID(), effectiveFrom: '2026-01-01', rateMinor: 0 }),
      ),
    ).toBe('finance_rates_rate_check');
  });

  it('a reminder set belongs to exactly one subject, a finance item now too', async () => {
    const g = await newGroup();
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const itemId = randomUUID();
    await db
      .insert(financeItems)
      .values({ id: itemId, groupId: g.id, title: 'N', type: 'note', createdBy: admin.id });
    await db
      .insert(reminderSets)
      .values({ id: randomUUID(), groupId: g.id, financeItemId: itemId, createdBy: admin.id });
    expect(
      await violated(
        db.insert(reminderSets).values({ id: randomUUID(), groupId: g.id, createdBy: admin.id }),
      ),
    ).toBe('reminder_sets_subject_check');
    // Deleting the item deletes its reminders.
    await db.delete(financeItems).where(eq(financeItems.id, itemId));
    expect(
      await db.select().from(reminderSets).where(eq(reminderSets.financeItemId, itemId)),
    ).toEqual([]);
  });
});
