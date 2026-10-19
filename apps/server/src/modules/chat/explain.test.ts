import { afterAll, describe, expect, inject, it } from 'vitest';
import type { SessionUser } from '@spolu/shared';
import { explainBest, expectIndexed } from '../../../test/explain.js';
import { createDb, type Db } from '../../infra/db/client.js';
import { prepareSearch } from '../../infra/text/search.js';
import { groupAccessOf, type GroupAccess } from '../groups/memberships.js';
import { messageSearchSql, type MessageSearchOptions } from './search.js';
import { messageVolumeIds } from './test-volume.js';

// This run's clone of the message volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').messages);
afterAll(() => close());

const TABLES = ['messages'];
const PAGE: MessageSearchOptions = { limit: 5 };

const actor = (id: string, role: 'admin' | 'client'): SessionUser => ({
  id,
  email: `${id}@x`,
  name: id,
  role,
  finance: false,
});

/**
 * Search in chat messages (2026-10-19) on a seeded volume of 400 000 messages: a rare term reads
 * `messages_search_text_trgm_idx` for an admin, a client of five groups and a ziadatel; a common
 * term never scans `messages` for a client or a ziadatel; a common term for an admin is bounded
 * by time only (a sequential scan can be the right plan there). Times with `RUN_BENCH=1`.
 */
describe('message search query plans on a seeded volume (2026-10-19)', () => {
  const { adminId, clientId, ziadatelId } = messageVolumeIds();
  const admin = actor(adminId, 'admin');
  const client = actor(clientId, 'client');
  const ziadatel = actor(ziadatelId, 'client');
  const none: GroupAccess = { roles: new Map() };
  const tx: Db = db;
  const query = (who: SessionUser, access: GroupAccess, q: string, opts = PAGE) =>
    messageSearchSql(tx, who, access, prepareSearch(q), opts)!.getSQL();

  it(
    'a rare term reads the trigram index for admin, client and ziadatel',
    { timeout: 120_000 },
    async () => {
      const accessC = await groupAccessOf(tx, clientId);
      const accessZ = await groupAccessOf(tx, ziadatelId);
      for (const [who, access] of [
        [admin, none],
        [client, accessC],
        [ziadatel, accessZ],
      ] as const) {
        await expectIndexed(tx, query(who, access, 'zmluva 123455'), TABLES, 30);
      }
    },
  );

  it(
    'a common term for a client and a ziadatel never scans messages',
    { timeout: 120_000 },
    async () => {
      const accessC = await groupAccessOf(tx, clientId);
      const accessZ = await groupAccessOf(tx, ziadatelId);
      await expectIndexed(tx, query(client, accessC, 'dobry den'), TABLES, 100);
      await expectIndexed(tx, query(ziadatel, accessZ, 'dobry den'), TABLES, 100);
    },
  );

  it(
    'a common term for the admin stays under 300 ms with RUN_BENCH=1',
    { timeout: 120_000 },
    async () => {
      const { time } = await explainBest(tx, query(admin, none, 'dobry den'));
      if (process.env.RUN_BENCH) expect(time).toBeLessThan(300);
    },
  );

  it('page two (cursor) reads the index too', { timeout: 120_000 }, async () => {
    const accessC = await groupAccessOf(tx, clientId);
    const cursor = { rank: 0, createdAt: new Date(Date.now() - 86_400_000).toISOString(), id: 'x' };
    await expectIndexed(tx, query(client, accessC, 'dobry den', { limit: 5, cursor }), TABLES, 100);
    await expectIndexed(tx, query(admin, none, 'zmluva 123455', { limit: 5, cursor }), TABLES, 30);
  });
});
