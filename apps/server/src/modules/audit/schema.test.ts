import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { auditLog } from './schema.js';
import { pgCode } from './test-helpers.js';

/** Inserts one raw row (bypassing recordAudit), `ageDays` old. */
async function insertRow(
  db: Db,
  ageDays = 0,
  overrides: Partial<typeof auditLog.$inferInsert> = {},
) {
  const id = randomUUID();
  await db.insert(auditLog).values({
    id,
    createdAt: new Date(Date.now() - ageDays * 86_400_000),
    actorKind: 'system',
    actorLabel: 'test',
    entityType: 'task',
    entityId: randomUUID(),
    entityLabel: 'Label',
    action: 'updated',
    ...overrides,
  });
  return id;
}

describe('audit_log', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(() => {
    ({ db, close } = createDb(testConfig().databaseUrl));
  });
  afterAll(() => close());

  it('an UPDATE of an audit row is refused with SPA01', async () => {
    const id = await insertRow(db);
    const error = await db
      .update(auditLog)
      .set({ entityLabel: 'Changed' })
      .where(eq(auditLog.id, id))
      .catch((e: unknown) => e);
    expect(pgCode(error)).toBe('SPA01');
  });

  it('a DELETE of a young row is refused with SPA01; a row older than 730 days can be deleted', async () => {
    const young = await insertRow(db, 10);
    const error = await db
      .delete(auditLog)
      .where(eq(auditLog.id, young))
      .catch((e: unknown) => e);
    expect(pgCode(error)).toBe('SPA01');
    const old = await insertRow(db, 731);
    const deleted = await db.delete(auditLog).where(eq(auditLog.id, old)).returning();
    expect(deleted).toHaveLength(1);
  });

  it('the anonymize setting allows an UPDATE of the labels only', async () => {
    const id = await insertRow(db);
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local spolu.audit_anonymize = 'on'`);
      await tx
        .update(auditLog)
        .set({ actorLabel: 'Vymazaný používateľ' })
        .where(eq(auditLog.id, id));
    });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id));
    expect(row!.actorLabel).toBe('Vymazaný používateľ');
    const error = await db
      .transaction(async (tx) => {
        await tx.execute(sql`set local spolu.audit_anonymize = 'on'`);
        await tx.update(auditLog).set({ entityId: 'other' }).where(eq(auditLog.id, id));
      })
      .catch((e: unknown) => e);
    expect(pgCode(error)).toBe('SPA01');
  });

  it('the actor checks refuse a user row without a user id and an mcp row without a token', async () => {
    const noUser = await insertRow(db, 0, { actorKind: 'user' }).catch((e: unknown) => e);
    expect(pgCode(noUser)).toBe('23514');
    const noToken = await insertRow(db, 0, { actorKind: 'mcp', actorUserId: 'u' }).catch(
      (e: unknown) => e,
    );
    expect(pgCode(noToken)).toBe('23514');
    const systemWithUser = await insertRow(db, 0, { actorUserId: 'u' }).catch((e: unknown) => e);
    expect(pgCode(systemWithUser)).toBe('23514');
  });
});
