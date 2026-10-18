import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditQuerySchema, type SessionUser } from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { systemActor, userActor } from './actor.js';
import { listAudit } from './list.js';
import { registerAuditResolver } from './resolvers.js';
import { recordAudit } from './service.js';

const viewer = (finance: boolean): SessionUser => ({
  id: randomUUID(),
  email: 'v@example.com',
  name: 'V',
  role: 'admin',
  finance,
});
const q = (input: Record<string, unknown>) => AuditQuerySchema.parse(input);

describe('the audit log keeps the finance seal', () => {
  let db: Db;
  let close: () => Promise<void>;
  const group = `g-${randomUUID()}`;
  const actorId = randomUUID();
  const financeItemId = randomUUID();
  let financeIds: string[] = [];
  let generalIds: string[] = [];
  let deactivationId = '';

  beforeAll(async () => {
    ({ db, close } = createDb(testConfig().databaseUrl));
    const by = userActor({ id: actorId, name: 'Finančník' });
    [deactivationId] = await recordAudit(db, by, [
      {
        entityType: 'admin',
        entityId: randomUUID(),
        entityLabel: 'Peter',
        groupId: group,
        action: 'deactivated',
      },
    ]);
    generalIds = [
      deactivationId!,
      ...(await recordAudit(db, by, [
        {
          entityType: 'task',
          entityId: randomUUID(),
          entityLabel: 'T',
          groupId: group,
          action: 'created',
        },
      ])),
    ];
    const revokedId = (
      await recordAudit(db, by, [
        {
          entityType: 'finance_access',
          entityId: randomUUID(),
          entityLabel: 'Peter',
          groupId: group,
          action: 'revoked',
          causeId: deactivationId,
        },
      ])
    )[0]!;
    // A general consequence of a finance row: its cause must not leak.
    generalIds.push(
      ...(await recordAudit(db, systemActor('t'), [
        {
          entityType: 'manager',
          entityId: randomUUID(),
          entityLabel: 'Peter',
          groupId: group,
          action: 'removed',
          causeId: revokedId,
        },
      ])),
    );
    financeIds = [
      revokedId,
      ...(await recordAudit(db, by, [
        {
          entityType: 'finance_item',
          entityId: financeItemId,
          entityLabel: 'Zmluva',
          groupId: group,
          action: 'created',
          changes: { amount: { to: { minor: 1000, currency: 'EUR' } } },
        },
        {
          entityType: 'rate',
          entityId: randomUUID(),
          entityLabel: 'Peter',
          groupId: group,
          action: 'created',
        },
      ])),
    ];
  });
  afterAll(() => close());

  const pageIds = async (who: SessionUser, input: Record<string, unknown>) => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listAudit(db, who, q({ ...input, cursor, limit: 2 }));
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  };

  it('a finance admin sees the finance rows', async () => {
    const ids = await pageIds(viewer(true), { group });
    expect(ids.sort()).toEqual([...generalIds, ...financeIds].sort());
  });

  it.each([
    ['the default page', {}],
    ['type=finance_item', { entityType: 'finance_item' }],
    ['type=rate', { entityType: 'rate' }],
    ['type=finance_access', { entityType: 'finance_access' }],
    ['the record itself', { entityType: 'finance_item', entityId: financeItemId }],
    ['the actor filter', { actor: `user:${actorId}` }],
  ])('a non-finance admin never gets a finance row: %s', async (_name, input) => {
    const ids = await pageIds(viewer(false), { group, ...input });
    for (const id of financeIds) expect(ids).not.toContain(id);
  });

  it("a non-finance admin following a finance admin's cursor gets no finance row", async () => {
    const first = await listAudit(db, viewer(true), q({ group, limit: 1 }));
    const page = await listAudit(
      db,
      viewer(false),
      q({ group, cursor: first.nextCursor!, limit: 100 }),
    );
    for (const item of page.items) expect(financeIds).not.toContain(item.id);
  });

  it('the general row whose cause is a finance row shows no cause pointing at it', async () => {
    const page = await listAudit(db, viewer(false), q({ group, entityType: 'manager' }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.cause).toBeNull();
    const finance = await listAudit(db, viewer(true), q({ group, entityType: 'manager' }));
    expect(finance.items[0]!.cause?.entityType).toBe('finance_access');
  });

  it('a finance resolver is not asked for a non-finance viewer', async () => {
    let asked = 0;
    registerAuditResolver('rate', {
      existingIds: async () => {
        asked++;
        return new Set();
      },
    });
    await listAudit(db, viewer(false), q({ group }));
    expect(asked).toBe(0);
    await listAudit(db, viewer(true), q({ group }));
    expect(asked).toBe(1);
  });

  it('the audit module imports no finance table', async () => {
    const dir = new URL('.', import.meta.url).pathname;
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const text = await readFile(join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/finance\/schema/);
      expect(text, file).not.toMatch(/finance_(items|folders|rates|time_entries)/);
      const financeImports = [...text.matchAll(/from '\.\.\/finance\/([^']+)'/g)].map((m) => m[1]);
      for (const path of financeImports) expect(path, file).toBe('policy.js');
    }
  });
});
