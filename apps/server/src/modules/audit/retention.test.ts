import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { AUDIT_CLEANUP_JOB, auditJobHandlers } from './jobs.js';
import { anonymizeActor, deleteOldAudit } from './retention.js';
import { auditLog } from './schema.js';
import { pgCode } from './test-helpers.js';

const DAY_MS = 86_400_000;

describe('audit retention and anonymize', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(() => {
    ({ db, close } = createDb(testConfig().databaseUrl));
  });
  afterAll(() => close());

  const insert = async (row: Partial<typeof auditLog.$inferInsert> & { ageDays?: number }) => {
    const id = randomUUID();
    const { ageDays = 0, ...rest } = row;
    await db.insert(auditLog).values({
      id,
      createdAt: new Date(Date.now() - ageDays * DAY_MS),
      actorKind: 'system',
      actorLabel: 'test',
      entityType: 'task',
      entityId: randomUUID(),
      entityLabel: 'Label',
      action: 'updated',
      ...rest,
    });
    return id;
  };

  it('deletes only rows older than 730 days, in batches until none are left', async () => {
    // Rows of earlier runs may be old too: run once first, then count ours.
    await deleteOldAudit(db);
    const old = await Promise.all([1, 2, 3, 4, 5].map((i) => insert({ ageDays: 730 + i })));
    const young = await Promise.all([1, 2, 3].map((i) => insert({ ageDays: 729 - i })));
    expect(await deleteOldAudit(db, new Date(), 2)).toBe(5);
    const left = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(inArray(auditLog.id, [...old, ...young]));
    expect(left.map((r) => r.id).sort()).toEqual(young.sort());
    await insert({ ageDays: 800 });
    await auditJobHandlers(db)[AUDIT_CLEANUP_JOB]!({});
    expect(await deleteOldAudit(db)).toBe(0);
  });

  it("replaces actor_label and the person's own membership and admin labels, and nothing else", async () => {
    const userId = randomUUID();
    const other = randomUUID();
    const authored = await insert({ actorKind: 'user', actorUserId: userId, actorLabel: 'Jana' });
    const admin = await insert({
      entityType: 'admin',
      entityId: userId,
      entityLabel: 'Jana',
      action: 'added',
    });
    const membership = await insert({
      entityType: 'membership',
      entityId: `g1:${userId}`,
      entityLabel: 'jana@example.com',
      action: 'invited',
    });
    const untouched = await insert({
      actorKind: 'user',
      actorUserId: other,
      actorLabel: 'Jana',
      entityLabel: 'Jana',
    });
    expect(await anonymizeActor(db, userId)).toBe(3);
    const rows = new Map(
      (
        await db
          .select()
          .from(auditLog)
          .where(inArray(auditLog.id, [authored, admin, membership, untouched]))
      ).map((r) => [r.id, r]),
    );
    expect(rows.get(authored)!.actorLabel).toBe('Vymazaný používateľ');
    expect(rows.get(authored)!.actorUserId).toBe(userId);
    expect(rows.get(admin)!.entityLabel).toBe('Vymazaný používateľ');
    expect(rows.get(membership)!.entityLabel).toBe('Vymazaný používateľ');
    expect(rows.get(untouched)!.actorLabel).toBe('Jana');
    expect(rows.get(untouched)!.entityLabel).toBe('Jana');
  });

  it('a plain UPDATE outside its setting is refused', async () => {
    const id = await insert({});
    const error = await db
      .update(auditLog)
      .set({ actorLabel: 'x' })
      .where(eq(auditLog.id, id))
      .catch((e: unknown) => e);
    expect(pgCode(error)).toBe('SPA01');
  });
});
