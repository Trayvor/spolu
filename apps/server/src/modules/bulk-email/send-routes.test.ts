import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type {
  BulkCampaignDto,
  BulkNotReadyAnswer,
  BulkRecipientPage,
  BulkTestSendResult,
} from '@spolu/shared';
import { createFakeBulkSender, type FakeBulkSender } from '../../infra/email/bulk.js';
import { newBulkPerson, newReadyCampaign } from '../../../test/bulk-sending.js';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { bulkRecipients } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; email: string; cookie: string };

describe('bulk email sending API', () => {
  let test: TestApp;
  let fake: FakeBulkSender;
  let admin: Person;
  let client: Person;

  const call = (method: 'GET' | 'POST', url: string, cookie?: string, payload?: unknown) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function newAdmin(): Promise<Person> {
    const email = `${randomUUID()}@example.com`;
    const created = await addAdmin(test.deps.db, { email, name: 'Route Admin' });
    return { id: created.id, email, cookie: await loginAs(test.app, email) };
  }

  const actor = () => ({
    id: admin.id,
    email: admin.email,
    name: 'Route Admin',
    role: 'admin' as const,
    finance: false,
  });

  beforeAll(async () => {
    fake = createFakeBulkSender();
    test = await buildTestApp({ bulkEmail: fake });
    admin = await newAdmin();
    const email = `${randomUUID()}@example.com`;
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Client', role: 'client', emailVerified: true });
    client = { id, email, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('client gets 403 and anonymous 401 on send, cancel, test and recipients', async () => {
    const id = await newReadyCampaign(test.deps.db, actor(), []);
    const routes: ['GET' | 'POST', string][] = [
      ['POST', `/api/bulk-email/campaigns/${id}/send`],
      ['POST', `/api/bulk-email/campaigns/${id}/cancel`],
      ['POST', `/api/bulk-email/campaigns/${id}/test`],
      ['GET', `/api/bulk-email/campaigns/${id}/recipients`],
    ];
    for (const [method, url] of routes) {
      expect((await call(method, url, client.cookie)).statusCode, url).toBe(403);
      expect((await call(method, url)).statusCode, url).toBe(401);
    }
  });

  it('send freezes the recipients and the first batch mails each of them', async () => {
    const a = await newBulkPerson(test.deps.db, { name: 'Alena' });
    const b = await newBulkPerson(test.deps.db, { name: 'Bohdan' });
    const id = await newReadyCampaign(test.deps.db, actor(), [a.id, b.id]);
    const before = fake.sent.length;

    const res = await call('POST', `/api/bulk-email/campaigns/${id}/send`, admin.cookie);

    expect(res.statusCode, res.body).toBe(200);
    const dto = res.json<BulkCampaignDto>();
    expect(dto).toMatchObject({ recipientCount: 2, sentBy: admin.id });
    // The test app runs jobs inline, so the first (and only) batch already ran.
    expect(dto.status).toBe('sent');
    expect(dto.counts.sent).toBe(2);
    const to = fake.sent.slice(before).map((m) => m.to[0]);
    expect(to.sort()).toEqual([a.email, b.email].sort());
  });

  it('send with nobody → 400 empty_audience and still a draft', async () => {
    const id = await newReadyCampaign(test.deps.db, actor(), []);
    const res = await call('POST', `/api/bulk-email/campaigns/${id}/send`, admin.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'empty_audience' });
    const get = await call('GET', `/api/bulk-email/campaigns/${id}`, admin.cookie);
    expect(get.json<BulkCampaignDto>().status).toBe('draft');
  });

  it('send of a campaign that is not ready → 400 not_ready with the problems', async () => {
    const a = await newBulkPerson(test.deps.db);
    const id = await newReadyCampaign(test.deps.db, actor(), [a.id], {
      blocks: [{ id: 'img', type: 'image', imageId: randomUUID(), alt: 'x' }],
    });
    const res = await call('POST', `/api/bulk-email/campaigns/${id}/send`, admin.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json<BulkNotReadyAnswer>()).toEqual({
      error: 'not_ready',
      problems: [{ blockId: 'img', problem: 'image_missing' }],
    });
  });

  it('send twice → 409 not_draft; unknown → 404', async () => {
    const a = await newBulkPerson(test.deps.db);
    const id = await newReadyCampaign(test.deps.db, actor(), [a.id]);
    expect(
      (await call('POST', `/api/bulk-email/campaigns/${id}/send`, admin.cookie)).statusCode,
    ).toBe(200);
    const again = await call('POST', `/api/bulk-email/campaigns/${id}/send`, admin.cookie);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'not_draft' });
    const unknown = await call(
      'POST',
      `/api/bulk-email/campaigns/${randomUUID()}/send`,
      admin.cookie,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('cancel stops a sending campaign; a draft → 409 not_sending', async () => {
    const id = await newReadyCampaign(test.deps.db, actor(), []);
    const draft = await call('POST', `/api/bulk-email/campaigns/${id}/cancel`, admin.cookie);
    expect(draft.statusCode).toBe(409);
    expect(draft.json()).toEqual({ error: 'not_sending' });

    // A sending campaign whose batch has not run yet: a queued row.
    const a = await newBulkPerson(test.deps.db);
    const sending = await newReadyCampaign(test.deps.db, actor(), [a.id]);
    await test.deps.db.execute(
      // Simulates the state between the send commit and the first batch.
      sql`
        with c as (update bulk_campaigns set status = 'sending' where id = ${sending} returning id)
        insert into bulk_recipients (campaign_id, user_id, email, name, language)
        select ${sending}, ${a.id}, ${a.email}, 'A', 'sk' from c`,
    );
    const res = await call('POST', `/api/bulk-email/campaigns/${sending}/cancel`, admin.cookie);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<BulkCampaignDto>()).toMatchObject({
      status: 'cancelled',
      counts: { cancelled: 1, queued: 0 },
    });
  });

  it('test send reaches only the admin with [Test] and answers their address', async () => {
    const a = await newBulkPerson(test.deps.db);
    const id = await newReadyCampaign(test.deps.db, actor(), [a.id]);
    const before = fake.sent.length;
    const res = await call('POST', `/api/bulk-email/campaigns/${id}/test`, admin.cookie);
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json<BulkTestSendResult>()).toEqual({ to: admin.email });
    const sent = fake.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([admin.email]);
    expect(sent[0]!.subject).toBe('[Test] News');
    const rows = await test.deps.db
      .select()
      .from(bulkRecipients)
      .where(eq(bulkRecipients.campaignId, id));
    expect(rows).toEqual([]);
  });

  it('test send of a campaign that is not ready → 400 not_ready', async () => {
    const id = await newReadyCampaign(test.deps.db, actor(), [], { subject: '' });
    const res = await call('POST', `/api/bulk-email/campaigns/${id}/test`, admin.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json<BulkNotReadyAnswer>().problems).toEqual([{ problem: 'subject_missing' }]);
  });

  it('the 11th test send a minute → 429', async () => {
    const other = await newAdmin();
    const id = await newReadyCampaign(test.deps.db, actor(), []);
    for (let i = 0; i < 10; i++) {
      const res = await call('POST', `/api/bulk-email/campaigns/${id}/test`, other.cookie);
      expect(res.statusCode).toBe(202);
    }
    const res = await call('POST', `/api/bulk-email/campaigns/${id}/test`, other.cookie);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });

  it('recipients filter by status, 50 per page with a cursor', async () => {
    const people = [];
    for (let i = 0; i < 53; i++) {
      people.push(await newBulkPerson(test.deps.db, { name: `R${String(i).padStart(2, '0')}` }));
    }
    const id = await newReadyCampaign(
      test.deps.db,
      actor(),
      people.map((p) => p.id),
    );
    // Sending in the test app runs the first batch inline: 20 sent, 33 queued.
    await call('POST', `/api/bulk-email/campaigns/${id}/send`, admin.cookie);
    const url = `/api/bulk-email/campaigns/${id}/recipients`;

    const first = (await call('GET', url, admin.cookie)).json<BulkRecipientPage>();
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toMatchObject({ name: 'R00', email: people[0]!.email });
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await call('GET', `${url}?cursor=${first.nextCursor}`, admin.cookie)
    ).json<BulkRecipientPage>();
    expect(second.items.map((r) => r.name)).toEqual(['R50', 'R51', 'R52']);
    expect(second.nextCursor).toBeNull();

    const sent = (await call('GET', `${url}?status=sent`, admin.cookie)).json<BulkRecipientPage>();
    expect(sent.items).toHaveLength(20);
    expect(sent.items.every((r) => r.status === 'sent' && r.sentAt !== null)).toBe(true);
    const queued = (
      await call('GET', `${url}?status=queued`, admin.cookie)
    ).json<BulkRecipientPage>();
    expect(queued.items).toHaveLength(33);

    expect((await call('GET', `${url}?status=nope`, admin.cookie)).statusCode).toBe(400);
    expect((await call('GET', `${url}?cursor=bad`, admin.cookie)).statusCode).toBe(400);
    const unknown = await call(
      'GET',
      `/api/bulk-email/campaigns/${randomUUID()}/recipients`,
      admin.cookie,
    );
    expect(unknown.statusCode).toBe(404);
  });
});
