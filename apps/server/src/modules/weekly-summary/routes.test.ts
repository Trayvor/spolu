import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { WeeklySummaryDto, WeeklySummaryList } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { countEmailsTo, latestEmail } from '../../../test/mail.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addManager } from '../groups/managers.js';
import { deactivateUser } from '../users/service.js';
import { prepareWeek } from './jobs.js';
import { weeklySummaries } from './schema.js';
import { weeklyHarness } from './test-harness.js';
import {
  insertSummary,
  makeAdmin,
  makeClient,
  makeGroup,
  makeManager,
  sampleContent,
} from './test-fixtures.js';
import { isoWeek } from './week.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const DAY = 86_400_000;

describe('weekly summary review routes', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    cookie?: string,
    payload?: object,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });

  async function signedInAdmin(groupId?: string) {
    const a = groupId ? await makeManager(db(), groupId) : await makeAdmin(db());
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, a.email) };
  }

  /** A group, its signed-in manager, one client, and this week's draft. */
  async function setup(name = 'Firma') {
    const g = await makeGroup(db(), name);
    const manager = await signedInAdmin(g.id);
    const client = await makeClient(db(), g.id, { language: 'it', name: 'Marco Rossi' });
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    return { g, manager, client, id };
  }

  const dto = async (id: string, cookie: string) =>
    (await call('GET', `/api/weekly-summaries/${id}`, cookie)).json<WeeklySummaryDto>();

  it('a client gets 403 on every summary route and no session 401', async () => {
    const { g, client, id } = await setup();
    const cookie = await loginAs(test.app, client.email);
    const routes: [string, string, object?][] = [
      ['GET', '/api/weekly-summaries'],
      ['GET', '/api/weekly-summaries/archive'],
      ['GET', `/api/weekly-summaries/${id}`],
      ['PATCH', `/api/weekly-summaries/${id}`, { version: 1, content: sampleContent() }],
      ['POST', `/api/weekly-summaries/${id}/regenerate`, { version: 1 }],
      ['GET', `/api/weekly-summaries/${id}/revisions`],
      ['POST', `/api/weekly-summaries/${id}/preview`, { language: 'sk' }],
      ['POST', `/api/weekly-summaries/${id}/test`],
      ['POST', `/api/weekly-summaries/${id}/send`, { version: 1 }],
      ['POST', `/api/weekly-summaries/${id}/skip`, { version: 1 }],
      ['GET', `/api/groups/${g.id}/weekly-summary/settings`],
      ['PUT', `/api/groups/${g.id}/weekly-summary/settings`, { enabled: false }],
    ];
    for (const [method, url, body] of routes) {
      const res = await call(method as 'GET', url, cookie, body);
      expect({ url, method, status: res.statusCode }).toEqual({ url, method, status: 403 });
      const anon = await call(method as 'GET', url, undefined, body);
      expect({ url, method, status: anon.statusCode }).toEqual({ url, method, status: 401 });
    }
  });

  it('an unknown or malformed id answers 404', async () => {
    const a = await signedInAdmin();
    for (const id of [randomUUID(), 'not-a-uuid', 'x'.repeat(150)]) {
      expect((await call('GET', `/api/weekly-summaries/${id}`, a.cookie)).statusCode).toBe(404);
    }
  });

  it('any admin lists and reads; canEdit is true only for the manager', async () => {
    const { manager, id } = await setup();
    const other = await signedInAdmin();
    expect(await dto(id, manager.cookie)).toMatchObject({ canEdit: true, managedByMe: true });
    expect(await dto(id, other.cookie)).toMatchObject({ canEdit: false, managedByMe: false });
    const all = await call('GET', '/api/weekly-summaries?scope=all&limit=50', other.cookie);
    expect(all.statusCode).toBe(200);
  });

  it("the list defaults to the admin's managed groups and pages by group name", async () => {
    const a = await setup(`A ${randomUUID()}`);
    const b = await makeGroup(db(), `B ${randomUUID()}`);
    const c = await makeGroup(db(), `C ${randomUUID()}`);
    for (const g of [b, c]) {
      await addManager(db(), g.id, a.manager.id);
      await makeClient(db(), g.id);
      await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    }
    const first = (
      await call('GET', '/api/weekly-summaries?limit=2', a.manager.cookie)
    ).json<WeeklySummaryList>();
    expect(first.items.map((i) => i.groupId)).toEqual([a.g.id, b.id]);
    expect(first.items[0]).toMatchObject({ status: 'draft', itemCount: 1, recipientCount: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await call(
        'GET',
        `/api/weekly-summaries?limit=2&cursor=${first.nextCursor}`,
        a.manager.cookie,
      )
    ).json<WeeklySummaryList>();
    expect(second.items.map((i) => i.groupId)).toEqual([c.id]);
    expect(second.nextCursor).toBeNull();
  });

  it('a non-manager admin gets 403 on patch, regenerate, test, skip and settings put', async () => {
    const { g, id } = await setup();
    const other = await signedInAdmin();
    const writes: [string, string, object?][] = [
      ['PATCH', `/api/weekly-summaries/${id}`, { version: 1, content: sampleContent() }],
      ['POST', `/api/weekly-summaries/${id}/regenerate`, { version: 1 }],
      ['POST', `/api/weekly-summaries/${id}/test`],
      ['POST', `/api/weekly-summaries/${id}/skip`, { version: 1 }],
      ['POST', `/api/weekly-summaries/${id}/send`, { version: 1 }],
      ['PUT', `/api/groups/${g.id}/weekly-summary/settings`, { enabled: false }],
    ];
    for (const [method, url, body] of writes) {
      const res = await call(method as 'POST', url, other.cookie, body);
      expect({ url, status: res.statusCode }).toEqual({ url, status: 403 });
    }
    expect(
      (await call('GET', `/api/groups/${g.id}/weekly-summary/settings`, other.cookie)).json(),
    ).toEqual({
      enabled: true,
      canEdit: false,
    });
  });

  it('patch saves content and bumps the version; an old version is 409 stale_version with the current dto', async () => {
    const { manager, id } = await setup();
    const saved = await call('PATCH', `/api/weekly-summaries/${id}`, manager.cookie, {
      version: 1,
      content: sampleContent('Nový text'),
      language: 'it',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<WeeklySummaryDto>()).toMatchObject({ version: 2, language: 'it' });
    const stale = await call('PATCH', `/api/weekly-summaries/${id}`, manager.cookie, {
      version: 1,
      content: sampleContent('Prepísané'),
    });
    expect(stale.statusCode).toBe(409);
    const body = stale.json<{ error: string; current: WeeklySummaryDto }>();
    expect(body.error).toBe('stale_version');
    expect(body.current.content.done[0]!.text).toBe('Nový text');
    expect(body.current.updatedBy).toEqual({ name: manager.name });
  });

  it('patch rejects a 501-character item with 400 validation_failed', async () => {
    const { manager, id } = await setup();
    const res = await call('PATCH', `/api/weekly-summaries/${id}`, manager.cookie, {
      version: 1,
      content: sampleContent('x'.repeat(501)),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
  });

  it('patch on a sent summary is 409 not_draft', async () => {
    const g = await makeGroup(db());
    const manager = await signedInAdmin(g.id);
    const id = await insertSummary(db(), {
      groupId: g.id,
      week: isoWeek(new Date()),
      status: 'sent',
    });
    const res = await call('PATCH', `/api/weekly-summaries/${id}`, manager.cookie, {
      version: 1,
      content: sampleContent(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_draft' });
  });

  it('regenerate answers 202, sets preparing and the job makes a new draft', async () => {
    const { manager, id } = await setup();
    const res = await call('POST', `/api/weekly-summaries/${id}/regenerate`, manager.cookie, {
      version: 1,
    });
    expect(res.statusCode).toBe(202);
    const after = await dto(id, manager.cookie);
    expect(after).toMatchObject({ status: 'draft', source: 'facts', revisionCount: 1, version: 3 });
  });

  it('the 11th regenerate in an hour is 429', async () => {
    const { manager, id } = await setup();
    for (let i = 0; i < 10; i++) {
      const { version } = await dto(id, manager.cookie);
      const res = await call('POST', `/api/weekly-summaries/${id}/regenerate`, manager.cookie, {
        version,
      });
      expect(res.statusCode).toBe(202);
    }
    const { version } = await dto(id, manager.cookie);
    const res = await call('POST', `/api/weekly-summaries/${id}/regenerate`, manager.cookie, {
      version,
    });
    expect(res.statusCode).toBe(429);
  });

  it('revisions and restore: newest first for any admin, restore only by the manager', async () => {
    const { manager, id } = await setup();
    const other = await signedInAdmin();
    await call('PATCH', `/api/weekly-summaries/${id}`, manager.cookie, {
      version: 1,
      content: sampleContent('Prvý'),
    });
    await call('POST', `/api/weekly-summaries/${id}/regenerate`, manager.cookie, { version: 2 });
    const list = (await call('GET', `/api/weekly-summaries/${id}/revisions`, other.cookie)).json<{
      items: { id: string; version: number; content: { done: { text: string }[] } }[];
    }>();
    expect(list.items.map((r) => [r.version, r.content.done[0]!.text])).toEqual([[2, 'Prvý']]);
    const revisionId = list.items[0]!.id;
    const forbidden = await call(
      'POST',
      `/api/weekly-summaries/${id}/revisions/${revisionId}/restore`,
      other.cookie,
      { version: 4 },
    );
    expect(forbidden.statusCode).toBe(403);
    const stale = await call(
      'POST',
      `/api/weekly-summaries/${id}/revisions/${revisionId}/restore`,
      manager.cookie,
      { version: 1 },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'stale_version' });
    const restored = await call(
      'POST',
      `/api/weekly-summaries/${id}/revisions/${revisionId}/restore`,
      manager.cookie,
      { version: 4 },
    );
    expect(restored.statusCode).toBe(200);
    expect(restored.json<WeeklySummaryDto>()).toMatchObject({ revisionCount: 2, version: 5 });
    expect(restored.json<WeeklySummaryDto>().content.done[0]!.text).toBe('Prvý');
  });

  it("an older week's draft is still editable by its manager", async () => {
    const g = await makeGroup(db());
    const manager = await signedInAdmin(g.id);
    const id = await insertSummary(db(), {
      groupId: g.id,
      week: isoWeek(new Date(Date.now() - 14 * DAY)),
      windowEnd: new Date(Date.now() - 14 * DAY),
    });
    const res = await call('PATCH', `/api/weekly-summaries/${id}`, manager.cookie, {
      version: 1,
      content: sampleContent('Neskorý'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('preview renders the email in the asked language without sending', async () => {
    const { client, id } = await setup();
    const other = await signedInAdmin();
    const res = await call('POST', `/api/weekly-summaries/${id}/preview`, other.cookie, {
      language: 'it',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ subject: string; html: string; text: string }>();
    expect(body.subject).toContain(
      serverTexts('it').weeklySummary.subject('Firma', '').split(':')[0],
    );
    expect(body.text).toContain('Podali sme žiadosť o platbu');
    expect(await countEmailsTo(client.email)).toBe(0);
  });

  it("test sends only to the acting admin's address", async () => {
    const { manager, client, id } = await setup();
    const res = await call('POST', `/api/weekly-summaries/${id}/test`, manager.cookie);
    expect(res.statusCode).toBe(204);
    expect(await countEmailsTo(client.email)).toBe(0);
    const mail = await latestEmail(manager.email);
    expect(mail.subject.startsWith('[Test] ')).toBe(true);
  });

  it('skip sets skipped with skip_reason manager', async () => {
    const { manager, id } = await setup();
    const res = await call('POST', `/api/weekly-summaries/${id}/skip`, manager.cookie, {
      version: 1,
    });
    expect(res.json<WeeklySummaryDto>()).toMatchObject({
      status: 'skipped',
      skipReason: 'manager',
    });
  });

  it('the dto never carries recipient emails', async () => {
    const { manager, client, id } = await setup();
    const body = await dto(id, manager.cookie);
    expect(body.recipients).toEqual([{ name: 'Marco Rossi', language: 'it' }]);
    expect(JSON.stringify(body)).not.toContain(client.email);
    expect(JSON.stringify(body)).not.toContain('searchText');
  });

  it('settings put by the manager turns the group off and prepare then skips it', async () => {
    const { g, manager } = await setup();
    await db().delete(weeklySummaries).where(eq(weeklySummaries.groupId, g.id));
    const res = await call('PUT', `/api/groups/${g.id}/weekly-summary/settings`, manager.cookie, {
      enabled: false,
    });
    expect(res.json()).toEqual({ enabled: false });
    const { deps } = weeklyHarness(db());
    expect(await prepareWeek(deps, new Date(), { groupIds: [g.id] })).toBe(0);
  });
  describe('audit rows (2026-10-19)', () => {
    it('send writes weekly_summary sent with the week and the recipient count, no content', async () => {
      const { g, manager, id } = await setup('Audit s.r.o.');
      const res = await call('POST', `/api/weekly-summaries/${id}/send`, manager.cookie, {
        version: 1,
      });
      expect(res.statusCode, res.body).toBe(202);
      const week = isoWeek(new Date());
      const rows = (await auditRowsOf(db(), id)).filter((r) => r.entityType === 'weekly_summary');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'sent',
        category: 'general',
        actorKind: 'user',
        actorUserId: manager.id,
        groupId: g.id,
        entityLabel: `Audit s.r.o. ${week}`,
        changes: { week: { to: week }, recipients: { to: 1 } },
      });
      expect(JSON.stringify(rows)).not.toContain('Marco');
    });

    it('a refused send (a stale version) writes no row', async () => {
      const { manager, id } = await setup();
      const res = await call('POST', `/api/weekly-summaries/${id}/send`, manager.cookie, {
        version: 7,
      });
      expect(res.statusCode).toBe(409);
      expect(await auditRowsOf(db(), id)).toEqual([]);
    });

    it('a settings change writes weekly_summary_setting updated; the same value again none', async () => {
      const { g, manager } = await setup('Nastavenia');
      const put = (enabled: boolean) =>
        call('PUT', `/api/groups/${g.id}/weekly-summary/settings`, manager.cookie, { enabled });
      await put(true); // on by default: nothing changes
      await put(false);
      await put(false);
      await put(true);
      const rows = (await auditRowsOf(db(), g.id)).filter(
        (r) => r.entityType === 'weekly_summary_setting',
      );
      expect(rows.map((r) => [r.action, r.changes])).toEqual([
        ['updated', { enabled: { from: true, to: false } }],
        ['updated', { enabled: { from: false, to: true } }],
      ]);
      expect(rows[0]).toMatchObject({
        actorUserId: manager.id,
        groupId: g.id,
        entityId: g.id,
        entityLabel: 'Nastavenia',
      });
    });
  });
});
