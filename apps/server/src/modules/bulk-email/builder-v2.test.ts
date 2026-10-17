import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { BulkAudienceSchema, type BulkBlock, type BulkCampaignDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { bulkCampaigns } from './schema.js';
import { validateForSend } from './send.js';

/** Phase 30: content version 2, the phone version and the one-time send warning (spec §2–§6). */

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const text = (t: string, extra: object = {}): BulkBlock =>
  ({
    id: `t-${t}`,
    type: 'text',
    align: 'left',
    content: [{ type: 'paragraph', content: [{ text: t, ...extra }] }],
  }) as BulkBlock;
const image = (id: string, imageId: string): BulkBlock => ({
  id,
  type: 'image',
  imageId,
  alt: 'A',
});
const columns = (left: BulkBlock[], right: BulkBlock[] = []): BulkBlock =>
  ({
    id: 'c',
    type: 'columns',
    ratio: '50-50',
    valign: 'top',
    divider: true,
    dividerColor: 'line',
    left,
    right,
  }) as BulkBlock;

describe('validateForSend with containers and a phone version', () => {
  it('checks images inside containers', () => {
    expect(
      validateForSend({ subject: 'S', blocks: [columns([], [image('i1', 'gone')])] }, new Set()),
    ).toEqual([{ blockId: 'i1', problem: 'image_missing' }]);
  });

  it('checks the phone version, marked phone: true; an empty one is no_blocks', () => {
    const problems = validateForSend(
      { subject: 'S', blocks: [text('a')], phoneBlocks: [image('i2', 'gone')] },
      new Set(),
    );
    expect(problems).toEqual([{ blockId: 'i2', problem: 'image_missing', phone: true }]);
    expect(
      validateForSend({ subject: 'S', blocks: [text('a')], phoneBlocks: [] }, new Set()),
    ).toEqual([{ problem: 'no_blocks', phone: true }]);
  });

  it('a phone version that follows desktop is not checked twice', () => {
    expect(
      validateForSend({ subject: 'S', blocks: [text('a')], phoneBlocks: null }, new Set()),
    ).toEqual([]);
  });
});

describe('bulk email API: builder v2', () => {
  let test: TestApp;
  let admin: string;
  let client: string;

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie?: string, payload?: unknown) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const create = async () => {
    const res = await call('POST', '/api/bulk-email/campaigns', admin, { name: 'V2' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<BulkCampaignDto>();
  };
  const save = (c: BulkCampaignDto, over: Record<string, unknown>) =>
    call('PUT', `/api/bulk-email/campaigns/${c.id}`, admin, {
      name: c.name,
      subject: c.subject,
      preheader: c.preheader,
      blocks: c.blocks,
      audience: c.audience,
      version: c.version,
      ...over,
    });

  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'V2 Admin' });
    admin = await loginAs(test.app, email);
    const clientEmail = `${randomUUID()}@example.com`;
    await test.deps.db.insert(user).values({
      id: randomUUID(),
      email: clientEmail,
      name: 'V2 Client',
      role: 'client',
      emailVerified: true,
    });
    client = await loginAs(test.app, clientEmail);
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('a new campaign has no phone version and no warning shown', async () => {
    const c = await create();
    expect(c.phoneBlocks).toBeNull();
    expect(c.phoneCheckShown).toBe(false);
  });

  it('saves a phone version; leaving it out keeps it, null makes it follow desktop', async () => {
    let c = await create();
    let res = await save(c, { blocks: [text('desk')], phoneBlocks: [text('phone')] });
    expect(res.statusCode, res.body).toBe(200);
    c = res.json<BulkCampaignDto>();
    expect(c.phoneBlocks).toEqual([text('phone')]);

    res = await save(c, { blocks: [text('desk 2')] });
    c = res.json<BulkCampaignDto>();
    expect(c.blocks).toEqual([text('desk 2')]);
    expect(c.phoneBlocks).toEqual([text('phone')]);

    res = await save(c, { phoneBlocks: null });
    expect(res.json<BulkCampaignDto>().phoneBlocks).toBeNull();
    const [row] = await test.deps.db
      .select({ v: bulkCampaigns.contentVersion })
      .from(bulkCampaigns)
      .where(eq(bulkCampaigns.id, c.id));
    expect(row?.v).toBe(2);
  });

  it('a split container with blocks on both sides is saved and read back', async () => {
    const c = await create();
    const blocks = [columns([text('l')], [{ id: 's', type: 'spacer', size: 'small' }])];
    const res = await save(c, { blocks });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<BulkCampaignDto>().blocks).toEqual(blocks);
  });

  it('XSS attempts in a text are refused (400), unknown keys are dropped', async () => {
    const c = await create();
    for (const bad of [
      text('x', { href: 'javascript:alert(1)' }),
      text('x', { href: 'data:text/html,<script>alert(1)</script>' }),
      text('x', { color: 'red;background:url(javascript:alert(1))' }),
      text('x', { marks: ['onclick'] }),
      { ...text('x'), content: [{ type: 'script', content: [] }] },
      columns([columns([])]),
    ]) {
      const res = await save(c, { blocks: [bad] });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    const res = await save(c, {
      blocks: [text('<img src=x onerror=alert(1)>', { html: '<script>x</script>', style: 'x' })],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<BulkCampaignDto>().blocks).toEqual([text('<img src=x onerror=alert(1)>')]);
  });

  it('reads a Phase 23 row (content version 1) upgraded, and its next save writes version 2', async () => {
    const id = randomUUID();
    await test.deps.db.insert(bulkCampaigns).values({
      id,
      name: 'Old',
      audience: BulkAudienceSchema.parse({}),
      contentVersion: 1,
      blocks: [{ id: 't', type: 'text', text: 'Old **bold**', align: 'center' }] as never,
    });
    const res = await call('GET', `/api/bulk-email/campaigns/${id}`, admin);
    const c = res.json<BulkCampaignDto>();
    expect(c.blocks).toEqual([
      {
        id: 't',
        type: 'text',
        align: 'center',
        content: [
          { type: 'paragraph', content: [{ text: 'Old ' }, { text: 'bold', marks: ['bold'] }] },
        ],
      },
    ]);
    expect((await save(c, {})).statusCode).toBe(200);
    const [row] = await test.deps.db
      .select({ v: bulkCampaigns.contentVersion, blocks: bulkCampaigns.blocks })
      .from(bulkCampaigns)
      .where(eq(bulkCampaigns.id, id));
    expect(row?.v).toBe(2);
    expect(row?.blocks).toEqual(c.blocks);
  });

  it('duplicate copies both versions and the content version, not the warning', async () => {
    let c = await create();
    c = (await save(c, { blocks: [text('d')], phoneBlocks: [text('p')] })).json<BulkCampaignDto>();
    await call('POST', `/api/bulk-email/campaigns/${c.id}/phone-check`, admin);
    const copy = (
      await call('POST', `/api/bulk-email/campaigns/${c.id}/duplicate`, admin)
    ).json<BulkCampaignDto>();
    expect(copy.blocks).toEqual([text('d')]);
    expect(copy.phoneBlocks).toEqual([text('p')]);
    expect(copy.phoneCheckShown).toBe(false);
  });

  describe('POST …/phone-check (the one-time send warning)', () => {
    it('401 without a session, 403 for a client, 404 for an unknown campaign', async () => {
      const c = await create();
      const url = `/api/bulk-email/campaigns/${c.id}/phone-check`;
      expect((await call('POST', url)).statusCode).toBe(401);
      expect((await call('POST', url, client)).statusCode).toBe(403);
      expect(
        (await call('POST', `/api/bulk-email/campaigns/${randomUUID()}/phone-check`, admin))
          .statusCode,
      ).toBe(404);
    });

    it('remembers that it was shown, survives a reload, is idempotent, keeps the version', async () => {
      const c = await create();
      const url = `/api/bulk-email/campaigns/${c.id}/phone-check`;
      expect((await call('POST', url, admin)).statusCode).toBe(204);
      expect((await call('POST', url, admin)).statusCode).toBe(204);
      const again = (
        await call('GET', `/api/bulk-email/campaigns/${c.id}`, admin)
      ).json<BulkCampaignDto>();
      expect(again.phoneCheckShown).toBe(true);
      expect(again.version).toBe(c.version);
      expect(again.updatedAt).toBe(c.updatedAt);
      // The editor's next save still works: the version did not move.
      expect((await save(again, { subject: 'x' })).statusCode).toBe(200);
    });
  });

  it('the preview renders both versions when the phone one is separate', async () => {
    const c = await create();
    const res = await call('POST', `/api/bulk-email/campaigns/${c.id}/preview`, admin, {
      subject: 'S',
      preheader: '',
      blocks: [text('desk')],
      phoneBlocks: [text('phone')],
    });
    expect(res.statusCode, res.body).toBe(200);
    const { html } = res.json<{ html: string }>();
    expect(html).toContain('sp-phone');
    expect(html).toContain('desk');
    expect(html).toContain('phone');
    const single = (
      await call('POST', `/api/bulk-email/campaigns/${c.id}/preview`, admin, {
        subject: 'S',
        preheader: '',
        blocks: [text('desk')],
      })
    ).json<{ html: string }>().html;
    expect(single).not.toContain('sp-phone');
  });
});
