import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Role, TicketStatus } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { groupManagers, groups } from '../groups/schema.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { ticketAssignees, tickets } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const migrationsDir = new URL('../../infra/db/migrations/', import.meta.url);

/** The hand-written backfill appended to the watch-settings migration, between its markers. */
function backfillSql(): string {
  const file = readdirSync(migrationsDir).find((f) =>
    f.endsWith('_drop_ticket_watch_settings.sql'),
  );
  if (!file) throw new Error('drop_ticket_watch_settings migration not found');
  const text = readFileSync(new URL(file, migrationsDir), 'utf8');
  const start = text.indexOf('-- backfill ticket managers: start');
  const end = text.indexOf('-- backfill ticket managers: end');
  if (start < 0 || end < start) throw new Error('backfill markers not found');
  return text.slice(start, end);
}

class Rollback extends Error {}

describe('the release backfill of manager riešitelia', () => {
  it('assigns the managers of open tickets without a riešiteľ, no events, the 10 earliest, once', async () => {
    const backfill = backfillSql();
    await db
      .transaction(async (tx) => {
        const newGroup = async () => {
          const id = randomUUID();
          await tx.insert(groups).values({
            id,
            name: 'Backfill',
            egrantUrl: `https://g${id.replaceAll('-', '')}.egrant.sk`,
            inviteToken: randomUUID(),
          });
          return id;
        };
        const newUser = async (role: Role, disabled = false) => {
          const id = randomUUID();
          await tx.insert(user).values({
            id,
            name: 'U',
            email: `${id}@example.com`,
            role,
            disabledAt: disabled ? new Date() : null,
          });
          return id;
        };
        const newTicket = async (groupId: string | null, status: TicketStatus) => {
          const id = randomUUID();
          const now = new Date();
          await tx.insert(tickets).values({
            id,
            groupId,
            status,
            source: 'manual',
            subject: 'T',
            createdAt: now,
            updatedAt: now,
          });
          return id;
        };
        const assigneesOf = async (ticketId: string) =>
          (
            await tx
              .select({ userId: ticketAssignees.userId })
              .from(ticketAssignees)
              .where(eq(ticketAssignees.ticketId, ticketId))
          )
            .map((r) => r.userId)
            .sort();

        const g = await newGroup();
        const manager = await newUser('admin');
        const superManager = await newUser('superadmin');
        const disabledManager = await newUser('admin', true);
        const colleague = await newUser('admin');
        await tx.insert(groupManagers).values([
          { groupId: g, userId: manager },
          { groupId: g, userId: superManager },
          { groupId: g, userId: disabledManager },
        ]);

        const fresh = await newTicket(g, 'new');
        const inProgress = await newTicket(g, 'in_progress');
        const resolved = await newTicket(g, 'resolved');
        const taken = await newTicket(g, 'new');
        await tx.insert(ticketAssignees).values({ ticketId: taken, userId: colleague });
        const noClient = await newTicket(null, 'new');

        // More than 10 managers: the 10 who became managers first keep the ticket.
        const crowded = await newGroup();
        const crowd: string[] = [];
        for (let i = 0; i < 12; i++) {
          const id = await newUser('admin');
          crowd.push(id);
          await tx.insert(groupManagers).values({
            groupId: crowded,
            userId: id,
            createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
          });
        }
        const crowdedTicket = await newTicket(crowded, 'new');

        await tx.execute(sql.raw(backfill));
        // Running it twice changes nothing.
        await tx.execute(sql.raw(backfill));

        const both = [manager, superManager].sort();
        expect(await assigneesOf(fresh)).toEqual(both);
        expect(await assigneesOf(inProgress)).toEqual(both);
        expect(await assigneesOf(resolved)).toEqual([]);
        expect(await assigneesOf(taken)).toEqual([colleague]);
        expect(await assigneesOf(noClient)).toEqual([]);
        expect(await assigneesOf(crowdedTicket)).toEqual(crowd.slice(0, 10).sort());

        // One audit row per added riešiteľ, as `addAssignee` writes it, by the system actor.
        const audited = (await auditRowsOf(tx, fresh)).filter((r) => r.action === 'assignee_added');
        expect(audited).toHaveLength(2);
        for (const row of audited) {
          expect(row).toMatchObject({
            actorKind: 'system',
            actorLabel: 'tickets.manager-autoassign',
            entityType: 'ticket',
            groupId: g,
            category: 'general',
          });
        }
        expect(
          audited.map((r) => (r.changes as { assignees: { added: { id: string }[] } }).assignees),
        ).toEqual(
          expect.arrayContaining([
            { added: [{ id: manager, label: 'U' }], removed: [] },
            { added: [{ id: superManager, label: 'U' }], removed: [] },
          ]),
        );
        // Nothing for the tickets that got nobody, and the crowded one has ten (not twelve).
        for (const skipped of [resolved, taken, noClient]) {
          expect(await auditRowsOf(tx, skipped)).toEqual([]);
        }
        expect(
          (await auditRowsOf(tx, crowdedTicket)).filter((r) => r.action === 'assignee_added'),
        ).toHaveLength(10);

        const events = await tx
          .select({ id: notificationEvents.id })
          .from(notificationEvents)
          .where(inArray(notificationEvents.userId, [manager, superManager, ...crowd]));
        expect(events).toEqual([]);
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
