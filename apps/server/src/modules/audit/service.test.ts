import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testConfig } from '../../../test/test-config.js';
import { egrantActor, systemActor, userActor, type AuditActor } from './actor.js';
import { auditLog } from './schema.js';
import { InvalidAuditActionError, recordAudit } from './service.js';
import { auditRowsOf } from './test-helpers.js';

describe('recordAudit', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(() => {
    ({ db, close } = createDb(testConfig().databaseUrl));
  });
  afterAll(() => close());

  const entry = (entityId: string) => ({
    entityType: 'task' as const,
    entityId,
    entityLabel: 'Pripraviť rozpočet',
    groupId: null,
    action: 'updated' as const,
    changes: { title: { from: 'A', to: 'B' } },
  });

  it("writes one row per entry with the actor's columns", async () => {
    const userId = randomUUID();
    const tokenId = randomUUID();
    const cases: [AuditActor, Record<string, unknown>][] = [
      [
        userActor({ id: userId, name: 'Jana' }),
        {
          actorKind: 'user',
          actorUserId: userId,
          actorTokenId: null,
          actorLabel: 'Jana',
          actorDetail: null,
        },
      ],
      [
        { kind: 'mcp', userId, name: 'Jana', tokenId, tokenName: 'Claude Desktop' },
        {
          actorKind: 'mcp',
          actorUserId: userId,
          actorTokenId: tokenId,
          actorLabel: 'Jana',
          actorDetail: 'Claude Desktop',
        },
      ],
      [
        egrantActor('groups', 'https://firma.egrant.sk'),
        {
          actorKind: 'egrant',
          actorUserId: null,
          actorLabel: 'https://firma.egrant.sk',
          actorDetail: 'groups',
        },
      ],
      [
        systemActor('audit.cleanup'),
        { actorKind: 'system', actorLabel: 'audit.cleanup', actorDetail: null },
      ],
    ];
    for (const [by, expected] of cases) {
      const id = randomUUID();
      const ids = await recordAudit(db, by, [entry(id), entry(id)]);
      expect(ids).toHaveLength(2);
      const rows = await auditRowsOf(db, id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        ...expected,
        entityType: 'task',
        action: 'updated',
        category: 'general',
      });
      expect(rows[0]!.changes).toEqual({ title: { from: 'A', to: 'B' } });
    }
  });

  it('sets the category from the catalogue', async () => {
    const id = randomUUID();
    await recordAudit(db, systemActor('t'), [
      { entityType: 'rate', entityId: id, entityLabel: 'Rate', groupId: null, action: 'created' },
    ]);
    expect((await auditRowsOf(db, id))[0]!.category).toBe('finance');
  });

  it('refuses an action of another type', async () => {
    const id = randomUUID();
    await expect(
      recordAudit(db, systemActor('t'), [
        { ...entry(id), action: 'granted' as unknown as 'updated' },
      ]),
    ).rejects.toBeInstanceOf(InvalidAuditActionError);
    expect(await auditRowsOf(db, id)).toHaveLength(0);
  });

  it('inside a rolled-back transaction leaves no row', async () => {
    const id = randomUUID();
    await expect(
      db.transaction(async (tx) => {
        await recordAudit(tx, systemActor('t'), [entry(id)]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await auditRowsOf(db, id)).toHaveLength(0);
  });

  it('truncates changes over 8 kB and marks _truncated', async () => {
    const id = randomUUID();
    const changes: Record<string, { from: string; to: string }> = {};
    for (let i = 0; i < 100; i++) changes[`f${i}`] = { from: 'x'.repeat(100), to: 'y'.repeat(100) };
    await recordAudit(db, systemActor('t'), [{ ...entry(id), changes }]);
    const [row] = await auditRowsOf(db, id);
    expect(row!.changes._truncated).toBe(true);
    expect(JSON.stringify(row!.changes).length).toBeLessThanOrEqual(8192);
    expect(row!.changes.f0).toEqual(changes.f0);
  });

  it('cuts the label to 200 characters', async () => {
    const id = randomUUID();
    await recordAudit(db, systemActor('t'), [{ ...entry(id), entityLabel: 'x'.repeat(500) }]);
    expect((await auditRowsOf(db, id))[0]!.entityLabel).toHaveLength(200);
  });

  it('with an empty list sends no query', async () => {
    const counting = createCountingDb();
    try {
      expect(await recordAudit(counting.db, systemActor('t'), [])).toEqual([]);
      expect(counting.count()).toBe(0);
      const id = randomUUID();
      await counting.db.execute(sql`select 1`); // the connection's own setup queries
      counting.reset();
      await recordAudit(counting.db, systemActor('t'), [entry(id), entry(id), entry(id)]);
      expect(counting.count()).toBe(1);
    } finally {
      await counting.close();
    }
  });

  it('keeps the cause id', async () => {
    const id = randomUUID();
    const [causeId] = await recordAudit(db, systemActor('t'), [entry(randomUUID())]);
    await recordAudit(db, systemActor('t'), [{ ...entry(id), causeId: causeId! }]);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(row!.causeId).toBe(causeId);
  });
});
