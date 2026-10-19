import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { createCountingDb } from '../../../test/query-counter.js';
import { buildTestApp } from '../../../test/test-app.js';
import type { AppDeps } from '../../deps.js';
import { addMembership, groupAccessOf, type GroupAccess } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { readableTicketLabels, requesterTicketIdsSql } from './search.js';
import { tickets } from './schema.js';

let deps: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
});
afterAll(() => close());

const NO_ACCESS: GroupAccess = { roles: new Map() };

async function person(role: 'admin' | 'client'): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await deps.db.insert(user).values({ id, email, name: id, role, emailVerified: true });
  return { id, email, name: id, role, finance: false };
}

async function group() {
  return createGroup(deps.db, {
    name: `Firma ${randomUUID()}`,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
}

async function ticket(groupId: string, requesterUserId: string | null, subject: string) {
  const now = new Date();
  const [row] = await deps.db
    .insert(tickets)
    .values({
      id: randomUUID(),
      groupId,
      source: 'manual',
      subject,
      requesterUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: tickets.id, number: tickets.number, subject: tickets.subject });
  return row!;
}

/** Message search (2026-10-19): the tickets module's SQL and labels for the chat's search. */
describe('ticket helpers of the message search', () => {
  let a: { id: string };
  let b: { id: string };
  let z: SessionUser;
  let client: SessionUser;
  let admin: SessionUser;
  let t1: Awaited<ReturnType<typeof ticket>>;
  let t2: Awaited<ReturnType<typeof ticket>>;
  let t3: Awaited<ReturnType<typeof ticket>>;

  beforeAll(async () => {
    a = await group();
    b = await group();
    z = await person('client');
    client = await person('client');
    admin = await person('admin');
    await addMembership(deps.db, z.id, a.id, 'ziadatel');
    await addMembership(deps.db, z.id, b.id, 'ziadatel');
    await addMembership(deps.db, client.id, a.id, 'client');
    t1 = await ticket(a.id, z.id, 'Moja chyba');
    t2 = await ticket(a.id, client.id, 'Cudzia chyba');
    t3 = await ticket(b.id, z.id, 'Iná skupina');
  });

  it("requesterTicketIdsSql lists only the actor's own tickets in the given groups", async () => {
    const rows = await deps.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(sql`${tickets.id} in (${requesterTicketIdsSql(z.id, [a.id])})`);
    expect(rows.map((r) => r.id)).toEqual([t1.id]);
    const both = await deps.db
      .select({ id: tickets.id })
      .from(tickets)
      .where(sql`${tickets.id} in (${requesterTicketIdsSql(z.id, [a.id, b.id])})`);
    expect(both.map((r) => r.id).sort()).toEqual([t1.id, t3.id].sort());
  });

  it('readableTicketLabels: client all of the group, ziadatel own only, admin all, one query', async () => {
    const accessZ = await groupAccessOf(deps.db, z.id);
    const accessC = await groupAccessOf(deps.db, client.id);
    expect([...(await readableTicketLabels(deps.db, z, accessZ, [t1.id, t2.id])).keys()]).toEqual([
      t1.id,
    ]);
    expect((await readableTicketLabels(deps.db, client, accessC, [t1.id, t2.id, t3.id])).size).toBe(
      2,
    );
    const counting = createCountingDb();
    try {
      // A warm-up: a new pooled connection reads the array types once (postgres-js).
      await readableTicketLabels(counting.db, admin, NO_ACCESS, [t1.id]);
      counting.reset();
      const labels = await readableTicketLabels(counting.db, admin, NO_ACCESS, [
        t1.id,
        t2.id,
        t3.id,
      ]);
      expect(labels.size).toBe(3);
      expect(labels.get(t1.id)).toEqual({ number: t1.number, subject: t1.subject });
      expect(counting.count()).toBe(1);
      counting.reset();
      expect((await readableTicketLabels(counting.db, admin, NO_ACCESS, [])).size).toBe(0);
      expect(counting.count()).toBe(0);
    } finally {
      await counting.close();
    }
  });

  afterAll(async () => {
    await deps.db.delete(tickets).where(inArray(tickets.id, [t1.id, t2.id, t3.id]));
  });
});
