import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HomeRemindersSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addAdmin } from '../users/service.js';
import { newGroup } from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('the registered Phase 17 reminder source', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(() => test.close());

  it('the registered source lists my knowledge reminder and counts the next 7 days', async () => {
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'Rem Admin' });
    const cookie = await loginAs(test.app, email);
    const group = await newGroup(test.deps.db, 'Reminded');
    const created = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${group.id}/knowledge`,
      headers: { cookie },
      payload: {
        type: 'reminder',
        title: 'Call the auditor',
        body: '',
        visibility: 'public',
        reminder: { times: [{ at: inDays(2) }, { at: inDays(9) }], recipientIds: [] },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const itemId = created.json<{ id: string }>().id;

    const res = await test.app.inject({
      method: 'GET',
      url: '/api/me/home/reminders',
      headers: { cookie },
    });
    const body = HomeRemindersSchema.parse(res.json());
    if (!body.available) throw new Error('the source is not registered');
    expect(body.nextWeek).toBe(1);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      title: 'Call the auditor',
      groupId: group.id,
      groupName: 'Reminded',
      target: { kind: 'knowledge', itemId },
    });
  });
});
