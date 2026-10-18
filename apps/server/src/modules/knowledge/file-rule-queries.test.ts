import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { KnowledgeItemDto, SessionUser } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { createFile } from '../files/service.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { fileOfLinkedKnowledge } from './link-routes.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;

/**
 * 2026-10-18 (S5): a file of a widely linked knowledge item is checked in a fixed number of
 * queries, not several per link: the subjects by kind, then the shareable items per group.
 */
describe('fileOfLinkedKnowledge query count', () => {
  let test: TestApp;
  const counting = createCountingDb();
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await counting.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'POST', url: string, cookie: string, payload: object) =>
    test.app.inject({ method, url, headers: { cookie }, payload });
  const group = () =>
    createGroup(db(), {
      name: 'Firma',
      egrantUrl: `https://q${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`,
    });
  const client = async (groupId: string): Promise<SessionUser> => {
    const c = await createUnverifiedClient(db(), newEmail());
    await addMembership(db(), c.id, groupId, 'client');
    return { id: c.id, email: c.email, name: 'C', role: 'client', finance: false };
  };

  /** A shareable admin-group note with a file, linked to `links` tasks of one client. */
  async function linkedFile(links: number) {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    const cookie = await loginAs(test.app, email);
    const adminGroup = await ensureAdminGroup(db());
    const file = await createFile(
      { db: db(), storage: test.deps.storage },
      {
        groupId: adminGroup,
        uploadedBy: a.id,
        name: 'metodika.txt',
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('text')]),
      },
    );
    const note = await call('POST', `/api/groups/${adminGroup}/knowledge`, cookie, {
      type: 'note',
      body: 'Text',
      title: 'Metodika',
      visibility: 'public',
      fileIds: [file.id],
    });
    expect(note.statusCode).toBe(201);
    const x = await group();
    for (let i = 0; i < links; i++) {
      const task = await call('POST', `/api/groups/${x.id}/tasks`, cookie, {
        title: `Úloha ${i}`,
        knowledgeIds: [note.json<KnowledgeItemDto>().id],
      });
      expect(task.statusCode).toBe(201);
    }
    return { file: { id: file.id, groupId: adminGroup, adminsOnly: false }, groupId: x.id };
  }

  const queries = async (actor: SessionUser, file: Parameters<typeof fileOfLinkedKnowledge>[2]) => {
    counting.reset();
    const readable = await fileOfLinkedKnowledge(counting.db, actor, file);
    return { readable, queries: counting.count() };
  };

  it('one link or six: the same number of queries, read or refused', async () => {
    const one = await linkedFile(1);
    const six = await linkedFile(6);
    const outsider = await client((await group()).id);
    // A first call warms what the process caches once (e.g. the admin group's id).
    await queries(outsider, one.file);
    const refusedOne = await queries(outsider, one.file);
    const refusedSix = await queries(outsider, six.file);
    expect(refusedOne.readable).toBe(false);
    expect(refusedSix).toEqual({ readable: false, queries: refusedOne.queries });
    const reader = await client(six.groupId);
    expect((await queries(reader, six.file)).readable).toBe(true);
  }, 60_000);
});
