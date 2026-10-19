import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditQuerySchema, type SessionUser } from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testConfig } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { egrantActor, systemActor, userActor, type AuditActor } from './actor.js';
import {
  decodeAuditCursor,
  encodeAuditCursor,
  InvalidAuditFilterError,
  listAudit,
} from './list.js';
import { registerAuditResolver } from './resolvers.js';
import { auditLog } from './schema.js';
import { recordAudit, type AuditEntry } from './service.js';

const financeViewer: SessionUser = {
  id: 'viewer-f',
  email: 'f@example.com',
  name: 'F',
  role: 'superadmin',
  finance: true,
};

const q = (input: Record<string, unknown>) => AuditQuerySchema.parse(input);

describe('listAudit', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(() => {
    ({ db, close } = createDb(testConfig().databaseUrl));
  });
  afterAll(() => close());

  const taskEntry = (groupId: string | null, over: Partial<AuditEntry> = {}): AuditEntry => ({
    entityType: 'task',
    entityId: randomUUID(),
    entityLabel: 'Task',
    groupId,
    action: 'updated',
    ...over,
  });

  it('newest first, keyset pages without gaps or repeats', async () => {
    const group = `g-${randomUUID()}`;
    const ids: string[] = [];
    // Two batches: one insert shares created_at, so ids break the tie.
    for (let i = 0; i < 2; i++) {
      ids.push(
        ...(await recordAudit(
          db,
          systemActor('t'),
          Array.from({ length: 60 }, () => taskEntry(group)),
        )),
      );
    }
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await listAudit(db, financeViewer, q({ group, cursor }));
      sizes.push(page.items.length);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(new Set(seen)).toEqual(new Set(ids));
    // Newest batch first.
    expect(seen.slice(0, 60).every((id) => ids.slice(60).includes(id))).toBe(true);
  });

  it('each filter alone narrows to the expected ids', async () => {
    const group = `g-${randomUUID()}`;
    const userId = randomUUID();
    const tokenId = randomUUID();
    const person: AuditActor = { kind: 'user', userId, name: 'Jana' };
    const mcp: AuditActor = { kind: 'mcp', userId, name: 'Jana', tokenId, tokenName: 'C' };
    const [u] = await recordAudit(db, person, [taskEntry(group)]);
    const [m] = await recordAudit(db, mcp, [taskEntry(group)]);
    const [e] = await recordAudit(db, egrantActor('groups', 'https://x.egrant.sk'), [
      { ...taskEntry(group), entityType: 'group', action: 'deactivated' },
    ]);
    const [s] = await recordAudit(db, systemActor('job'), [
      taskEntry(group, { entityId: 'fixed-' + group }),
    ]);
    const ids = async (input: Record<string, unknown>) =>
      (await listAudit(db, financeViewer, q({ group, ...input }))).items.map((i) => i.id).sort();
    expect(await ids({})).toEqual([u, m, e, s].sort());
    expect(await ids({ entityType: 'group' })).toEqual([e]);
    expect(await ids({ entityType: 'task', entityId: 'fixed-' + group })).toEqual([s]);
    expect(await ids({ actor: `user:${userId}` })).toEqual([u, m].sort());
    expect(await ids({ actor: `token:${tokenId}` })).toEqual([m]);
    expect(await ids({ actor: 'kind:egrant' })).toEqual([e]);
    expect(await ids({ actor: 'kind:system' })).toEqual([s]);
    expect(await ids({ actor: 'kind:mcp' })).toEqual([m]);
    // Filters combine.
    expect(await ids({ entityType: 'task', actor: `user:${userId}` })).toEqual([u, m].sort());
    expect(await ids({ entityType: 'group', actor: `user:${userId}` })).toEqual([]);
  });

  it('from and to are Bratislava days', async () => {
    const group = `g-${randomUUID()}`;
    const insert = async (at: string) => {
      const id = randomUUID();
      await db.insert(auditLog).values({
        id,
        createdAt: new Date(at),
        actorKind: 'system',
        actorLabel: 't',
        entityType: 'task',
        entityId: randomUUID(),
        entityLabel: 'T',
        groupId: group,
        action: 'updated',
      });
      return id;
    };
    // 23:30 UTC on the 18th is 01:30 on the 19th in Bratislava (summer time, UTC+2).
    const late18 = await insert('2026-10-18T23:30:00Z');
    const early18 = await insert('2026-10-18T10:00:00Z');
    const day20 = await insert('2026-10-20T12:00:00Z');
    const ids = async (input: Record<string, unknown>) =>
      (await listAudit(db, financeViewer, q({ group, ...input }))).items.map((i) => i.id).sort();
    expect(await ids({ from: '2026-10-19', to: '2026-10-19' })).toEqual([late18]);
    expect(await ids({ to: '2026-10-18' })).toEqual([early18]);
    expect(await ids({ from: '2026-10-19' })).toEqual([late18, day20].sort());
  });

  it('a user filter works for a client author, not only admins', async () => {
    const group = `g-${randomUUID()}`;
    const clientId = randomUUID();
    const [id] = await recordAudit(db, userActor({ id: clientId, name: 'Klient' }), [
      taskEntry(group),
    ]);
    const page = await listAudit(db, financeViewer, q({ actor: `user:${clientId}` }));
    expect(page.items.map((i) => i.id)).toEqual([id]);
  });

  it('current names win over snapshots; a missing person falls back to the snapshot', async () => {
    const email = `${randomUUID()}@example.com`;
    const admin = await addAdmin(db, { email, name: 'Nové meno' });
    const g = await createGroup(db, {
      name: 'Mesto Senica',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    await recordAudit(db, userActor({ id: admin.id, name: 'Staré meno' }), [taskEntry(g.id)]);
    await recordAudit(db, userActor({ id: 'gone-' + randomUUID(), name: 'Snapshot' }), [
      taskEntry(g.id),
    ]);
    await deactivateUser(db, admin.id);
    const page = await listAudit(db, financeViewer, q({ group: g.id }));
    const names = page.items.map((i) => (i.actor.kind === 'user' ? i.actor : null));
    expect(names).toContainEqual(expect.objectContaining({ name: 'Nové meno', deactivated: true }));
    expect(names).toContainEqual(expect.objectContaining({ name: 'Snapshot', deactivated: false }));
    expect(page.items[0]!.group).toEqual({ id: g.id, name: 'Mesto Senica' });
  });

  it('linkable is true only for ids a resolver says exist', async () => {
    const group = `g-${randomUUID()}`;
    const live = randomUUID();
    registerAuditResolver('bucket', {
      existingIds: async (_db, ids) => new Set(ids.filter((id) => id === live)),
    });
    await recordAudit(db, systemActor('t'), [
      { entityType: 'bucket', entityId: live, entityLabel: 'B', groupId: group, action: 'created' },
      {
        entityType: 'bucket',
        entityId: randomUUID(),
        entityLabel: 'B',
        groupId: group,
        action: 'deleted',
      },
    ]);
    const page = await listAudit(db, financeViewer, q({ group }));
    expect(page.items.map((i) => [i.entityId === live, i.linkable])).toEqual(
      expect.arrayContaining([
        [true, true],
        [false, false],
      ]),
    );
  });

  it('cause is filled for a consequence row', async () => {
    const group = `g-${randomUUID()}`;
    const [causeId] = await recordAudit(db, systemActor('t'), [
      {
        entityType: 'admin',
        entityId: randomUUID(),
        entityLabel: 'Peter',
        groupId: group,
        action: 'deactivated',
      },
    ]);
    await recordAudit(db, systemActor('t'), [
      {
        entityType: 'manager',
        entityId: randomUUID(),
        entityLabel: 'Peter',
        groupId: group,
        action: 'removed',
        causeId,
      },
    ]);
    const page = await listAudit(db, financeViewer, q({ group, entityType: 'manager' }));
    expect(page.items[0]!.cause).toEqual({
      id: causeId,
      entityType: 'admin',
      action: 'deactivated',
      entityLabel: 'Peter',
    });
  });

  it('a page costs at most 5 queries', async () => {
    const group = `g-${randomUUID()}`;
    const [causeId] = await recordAudit(db, systemActor('t'), [taskEntry(group)]);
    await recordAudit(
      db,
      userActor({ id: randomUUID(), name: 'X' }),
      Array.from({ length: 30 }, () => taskEntry(group, { causeId })),
    );
    const counting = createCountingDb();
    try {
      // A first call opens the pool's connections (their setup queries count too).
      await listAudit(counting.db, financeViewer, q({ group }));
      counting.reset();
      const page = await listAudit(counting.db, financeViewer, q({ group }));
      expect(page.items).toHaveLength(31);
      expect(counting.count()).toBeLessThanOrEqual(5);
    } finally {
      await counting.close();
    }
  });

  it('a cursor round-trips and a malformed one is an invalid filter', () => {
    const c = { createdAt: '2026-10-19 10:00:00.123456+00', id: 'x' };
    expect(decodeAuditCursor(encodeAuditCursor(c))).toEqual(c);
    expect(() => decodeAuditCursor('nope')).toThrow(InvalidAuditFilterError);
    expect(() => decodeAuditCursor(Buffer.from('["x","y"]').toString('base64url'))).toThrow(
      InvalidAuditFilterError,
    );
  });
});
