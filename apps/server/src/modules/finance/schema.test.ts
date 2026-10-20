import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { reminderSets } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import {
  financeContractShares,
  financeCostDocuments,
  financeItems,
  financeRates,
  financeSalaries,
  financeTimeEntries,
} from './schema.js';

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

  it('only a ticket or a manual entry may lack a client (decision 24, migration 0041)', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const base = { groupId: null, userId: admin.id, createdBy: admin.id, updatedBy: admin.id };
    await db.insert(financeTimeEntries).values({
      ...base,
      id: randomUUID(),
      source: 'manual',
      minutes: 30,
      workedOn: '2026-10-01',
    });
    expect(
      await violated(
        db
          .insert(financeTimeEntries)
          .values({ ...base, id: randomUUID(), source: 'task', title: 'Task' }),
      ),
    ).toBe('finance_time_entries_group_check');
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

describe('finance at organisation level (Phase 32 E, migration 0044)', () => {
  const expense = (createdBy: string, extra: object = {}) => ({
    id: randomUUID(),
    groupId: null,
    type: 'expense' as const,
    title: 'Server',
    createdBy,
    amountMinor: 4_900,
    currency: 'EUR' as const,
    startsOn: '2026-10-31',
    endsOn: '2026-10-31',
    expenseKind: 'other' as const,
    ...extra,
  });

  it('an expense has its amount, a one-day period, a kind and no client', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const g = await newGroup();
    await db.insert(financeItems).values(expense(admin.id));
    for (const [extra, constraint] of [
      [{ endsOn: null }, 'finance_items_contract_check'],
      [{ endsOn: '2026-11-01' }, 'finance_items_contract_check'],
      [{ amountMinor: null }, 'finance_items_contract_check'],
      [{ expenseKind: null }, 'finance_items_contract_check'],
      [{ groupId: g.id }, 'finance_items_contract_check'],
      [{ contractNumber: 'Z-1' }, 'finance_items_contract_check'],
      [{ payerName: 'Obec' }, 'finance_items_contract_check'],
      [{ expenseKind: 'bonus' }, 'finance_items_expense_kind_check'],
      // No salary kind since migration 0069 (2026-10-21): salaries are their own records.
      [{ expenseKind: 'salary' }, 'finance_items_expense_kind_check'],
      // An expense says what it is.
      [{ title: '' }, 'finance_items_title_check'],
    ] as const) {
      expect(
        await violated(db.insert(financeItems).values(expense(admin.id, extra))),
        constraint,
      ).toBe(constraint);
    }
  });

  it('a salary (migration 0069) is of an admin, a month (its first day), 0 or more, a currency', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const salary = (extra: object = {}) => ({
      id: randomUUID(),
      payeeId: admin.id,
      month: '2026-09-01',
      amountMinor: 0,
      createdBy: admin.id,
      ...extra,
    });
    await db.insert(financeSalaries).values(salary());
    for (const [extra, constraint] of [
      [{ month: '2026-09-02' }, 'finance_salaries_month_check'],
      [{ amountMinor: -1 }, 'finance_salaries_amount_check'],
      [{ currency: 'USD' }, 'finance_salaries_currency_check'],
      [{ note: 'x'.repeat(10_501) }, 'finance_salaries_note_check'],
      [{ payeeId: randomUUID() }, 'finance_salaries_payee_id_user_id_fk'],
    ] as const) {
      expect(await violated(db.insert(financeSalaries).values(salary(extra))), constraint).toBe(
        constraint,
      );
    }
  });

  it('a document link names exactly one cost, once', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const salaryId = randomUUID();
    await db.insert(financeSalaries).values({
      id: salaryId,
      payeeId: admin.id,
      month: '2026-09-01',
      amountMinor: 1,
      createdBy: admin.id,
    });
    const documentId = randomUUID();
    const expenseId = randomUUID();
    await db
      .insert(financeItems)
      .values([
        { id: documentId, type: 'document', title: 'Páska', createdBy: admin.id },
        expense(admin.id, { id: expenseId }),
      ]);
    const link = (extra: object) => ({ id: randomUUID(), documentId, ...extra });
    await db.insert(financeCostDocuments).values(link({ salaryId }));
    await db.insert(financeCostDocuments).values(link({ expenseId }));
    for (const [extra, constraint] of [
      [{}, 'finance_cost_documents_target_check'],
      [{ salaryId, expenseId }, 'finance_cost_documents_target_check'],
      [{ salaryId }, 'finance_cost_documents_salary_unique'],
      [{ expenseId }, 'finance_cost_documents_expense_unique'],
      [{ expenseId: documentId }, 'finance_cost_documents_self_check'],
    ] as const) {
      expect(await violated(db.insert(financeCostDocuments).values(link(extra))), constraint).toBe(
        constraint,
      );
    }
    // The salary's or the document's delete takes its links.
    await db.delete(financeSalaries).where(eq(financeSalaries.id, salaryId));
    await db.delete(financeItems).where(eq(financeItems.id, documentId));
    expect(
      await db
        .select()
        .from(financeCostDocuments)
        .where(eq(financeCostDocuments.expenseId, expenseId)),
    ).toEqual([]);
  });

  it('a contract has a client or a payer, never both nor neither; a note has neither', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const g = await newGroup();
    const contract = {
      type: 'contract' as const,
      title: 'Zmluva',
      createdBy: admin.id,
      amountMinor: 300_000,
      currency: 'EUR' as const,
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    };
    await db
      .insert(financeItems)
      .values({ ...contract, id: randomUUID(), groupId: null, payerName: 'Mikroregión' });
    expect(
      await violated(
        db.insert(financeItems).values({ ...contract, id: randomUUID(), groupId: null }),
      ),
    ).toBe('finance_items_contract_check');
    expect(
      await violated(
        db
          .insert(financeItems)
          .values({ ...contract, id: randomUUID(), groupId: g.id, payerName: 'Obec' }),
      ),
    ).toBe('finance_items_contract_check');
    expect(
      await violated(
        db.insert(financeItems).values({
          ...contract,
          id: randomUUID(),
          groupId: null,
          payerName: 'Obec',
          expenseKind: 'other',
        }),
      ),
    ).toBe('finance_items_contract_check');
    expect(
      await violated(
        db.insert(financeItems).values({
          id: randomUUID(),
          groupId: null,
          type: 'note',
          title: 'N',
          createdBy: admin.id,
          payerName: 'Obec',
        }),
      ),
    ).toBe('finance_items_contract_check');
  });

  it('a share is above zero, once per client, and goes with its contract or its client', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const [g1, g2] = [await newGroup(), await newGroup()];
    const itemId = randomUUID();
    await db.insert(financeItems).values({
      id: itemId,
      groupId: null,
      type: 'contract',
      title: 'Spoločná zmluva',
      createdBy: admin.id,
      amountMinor: 300,
      currency: 'EUR',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      payerName: 'Mikroregión',
    });
    await db.insert(financeContractShares).values([
      { itemId, groupId: g1.id, amountMinor: 100 },
      { itemId, groupId: g2.id, amountMinor: 200 },
    ]);
    expect(
      await violated(
        db.insert(financeContractShares).values({ itemId, groupId: g1.id, amountMinor: 5 }),
      ),
    ).toBe('finance_contract_shares_item_id_group_id_pk');
    const g3 = await newGroup();
    expect(
      await violated(
        db.insert(financeContractShares).values({ itemId, groupId: g3.id, amountMinor: 0 }),
      ),
    ).toBe('finance_contract_shares_amount_check');
    // A client's delete takes its share only (decision E21); the contract's delete takes all.
    await db.execute(sql`delete from groups where id = ${g1.id}`);
    expect(
      (
        await db
          .select()
          .from(financeContractShares)
          .where(eq(financeContractShares.itemId, itemId))
      ).map((s) => s.groupId),
    ).toEqual([g2.id]);
    await db.delete(financeItems).where(eq(financeItems.id, itemId));
    expect(
      await db.select().from(financeContractShares).where(eq(financeContractShares.itemId, itemId)),
    ).toEqual([]);
  });

  it('a reminder set lacks a client only for a finance item', async () => {
    const admin = await addAdmin(db, { email: email(), name: 'A' });
    const item = expense(admin.id);
    await db.insert(financeItems).values(item);
    await db
      .insert(reminderSets)
      .values({ id: randomUUID(), groupId: null, financeItemId: item.id, createdBy: admin.id });
    // The CHECK runs before the (missing) knowledge item's foreign key.
    expect(
      await violated(
        db.insert(reminderSets).values({
          id: randomUUID(),
          groupId: null,
          knowledgeItemId: randomUUID(),
          createdBy: admin.id,
        }),
      ),
    ).toBe('reminder_sets_group_check');
  });
});
