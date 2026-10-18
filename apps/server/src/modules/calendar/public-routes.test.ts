import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../../../test/test-app.js';
import {
  dayFromNow,
  feedAdmin,
  feedCall,
  feedClient,
  feedEvent,
  feedGroup,
  feedProject,
  inDays,
  uidsOf,
} from '../../../test/calendar.js';
import { removeMembership } from '../groups/memberships.js';
import { setGroupDeactivated } from '../groups/service.js';
import { projectEvents } from '../projects/schema.js';
import { user } from '../users/schema.js';
import { deactivateUser } from '../users/service.js';
import { deleteFeedOf, getFeed, putFeed, rotateFeed, toFeedDto } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const include = { events: true, tasks: true, calls: true };

describe('GET /api/public/calendar/:token/help.ics (ADR 0051)', () => {
  let test: TestApp;
  const logLines: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ logStream: { write: (line) => void logLines.push(line) } });
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  /** The path of the person's feed (created when missing). */
  async function feedPath(person: { id: string }): Promise<string> {
    const { row } = await putFeed(test.deps.db, test.deps.config.appSecret, person.id, include);
    const url = toFeedDto(row, test.deps.config.publicUrl, test.deps.config.appSecret).url;
    return new URL(url).pathname;
  }
  const get = (url: string, headers: Record<string, string> = {}) =>
    test.app.inject({ method: 'GET', url, headers });

  it('serves the feed with the calendar headers', async () => {
    const g = (await feedGroup(test.deps.db)).id;
    const client = await feedClient(test.deps.db, [g]);
    const res = await get(await feedPath(client));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('inline; filename="help.ics"');
    expect(res.headers['cache-control']).toBe('private, max-age=900');
    expect(res.headers.etag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.body.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(res.body).toContain('X-WR-CALNAME:Help – Mária Nováková');
  });

  it('answers 304 with no body for a matching If-None-Match', async () => {
    const g = (await feedGroup(test.deps.db)).id;
    const client = await feedClient(test.deps.db, [g]);
    const path = await feedPath(client);
    const first = await get(path);
    const again = await get(path, { 'if-none-match': first.headers.etag as string });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect(again.headers.etag).toBe(first.headers.etag);
  });

  it('changes the ETag after an edit and after a delete', async () => {
    const g = (await feedGroup(test.deps.db)).id;
    const client = await feedClient(test.deps.db, [g]);
    const p = await feedProject(test.deps.db, g);
    const e = await feedEvent(test.deps.db, { projectId: p, groupId: g, occursOn: dayFromNow(4) });
    const path = await feedPath(client);
    const first = await get(path);
    await test.deps.db
      .update(projectEvents)
      .set({ name: 'Zmenené', updatedAt: new Date() })
      .where(eq(projectEvents.id, e));
    const edited = await get(path, { 'if-none-match': first.headers.etag as string });
    expect(edited.statusCode).toBe(200);
    expect(edited.headers.etag).not.toBe(first.headers.etag);
    await test.deps.db.delete(projectEvents).where(eq(projectEvents.id, e));
    const deleted = await get(path, { 'if-none-match': edited.headers.etag as string });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.body).not.toContain(`event-${e}@spolu`);
  });

  it('old token is 404 after rotate, revoke and deactivation', async () => {
    const admin = await feedAdmin(test.deps.db);
    const old = await feedPath(admin);
    await rotateFeed(test.deps.db, test.deps.config.appSecret, admin.id);
    expect((await get(old)).statusCode).toBe(404);
    const fresh = toFeedDto(
      (await getFeed(test.deps.db, admin.id))!,
      test.deps.config.publicUrl,
      test.deps.config.appSecret,
    ).url;
    const freshPath = new URL(fresh).pathname;
    expect((await get(freshPath)).statusCode).toBe(200);
    await deleteFeedOf(test.deps.db, admin.id);
    expect((await get(freshPath)).statusCode).toBe(404);

    const other = await feedAdmin(test.deps.db);
    const path = await feedPath(other);
    expect((await get(path)).statusCode).toBe(200);
    await deactivateUser(test.deps.db, other.id);
    const gone = await get(path);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ error: 'not_found' });
  });

  it('a disabled user whose row survived is 404', async () => {
    const admin = await feedAdmin(test.deps.db);
    const path = await feedPath(admin);
    // As if the feed outlived the account (deactivateUser deletes it).
    await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, admin.id));
    expect((await get(path)).statusCode).toBe(404);
  });

  it('a malformed or unknown token is 404', async () => {
    for (const token of ['abc', randomBytes(32).toString('base64url')]) {
      const res = await get(`/api/public/calendar/${token}/help.ics`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('drops a deactivated group and a removed membership on the next fetch', async () => {
    const db = test.deps.db;
    const g1 = (await feedGroup(db, 'Zostáva')).id;
    const g2 = (await feedGroup(db, 'Odchádza')).id;
    const g3 = (await feedGroup(db, 'Vypnutá')).id;
    const admin = await feedAdmin(db, 'Watcher', [g1, g3]);
    const client = await feedClient(db, [g1, g2, g3]);
    const events: Record<string, string> = {};
    for (const g of [g1, g2, g3]) {
      const p = await feedProject(db, g);
      events[g] = await feedEvent(db, { projectId: p, groupId: g, occursOn: dayFromNow(3) });
    }
    const call3 = await feedCall(db, { groupId: g3, createdBy: admin.id, startsAt: inDays(2) });
    const clientPath = await feedPath(client);
    const adminPath = await feedPath(admin);
    const uids = async (path: string) => uidsOf((await get(path)).body);
    expect(await uids(clientPath)).toEqual(
      expect.arrayContaining([g1, g2, g3].map((g) => `event-${events[g]}@spolu`)),
    );
    expect(await uids(adminPath)).toEqual(
      expect.arrayContaining([`event-${events[g3]}@spolu`, `call-${call3}@spolu`]),
    );

    await removeMembership(db, g2, client.id);
    await setGroupDeactivated(db, g3, true);
    const clientNow = await uids(clientPath);
    expect(clientNow).toContain(`event-${events[g1]}@spolu`);
    expect(clientNow).not.toContain(`event-${events[g2]}@spolu`);
    expect(clientNow).not.toContain(`event-${events[g3]}@spolu`);
    expect(clientNow).not.toContain(`call-${call3}@spolu`);
    const adminNow = await uids(adminPath);
    expect(adminNow).toContain(`event-${events[g1]}@spolu`);
    expect(adminNow).not.toContain(`event-${events[g3]}@spolu`);
    expect(adminNow).not.toContain(`call-${call3}@spolu`);
  });

  it('leaves admins-only calls out for a client', async () => {
    const db = test.deps.db;
    const g = (await feedGroup(db)).id;
    const admin = await feedAdmin(db, 'Calls Admin', [g]);
    const client = await feedClient(db, [g]);
    const open = await feedCall(db, { groupId: g, createdBy: admin.id, startsAt: inDays(2) });
    const closed = await feedCall(db, {
      groupId: g,
      createdBy: admin.id,
      startsAt: inDays(2),
      visibility: 'admins',
    });
    const forClient = uidsOf((await get(await feedPath(client))).body);
    expect(forClient).toContain(`call-${open}@spolu`);
    expect(forClient).not.toContain(`call-${closed}@spolu`);
    const forAdmin = uidsOf((await get(await feedPath(admin))).body);
    expect(forAdmin).toEqual(
      expect.arrayContaining([`call-${open}@spolu`, `call-${closed}@spolu`]),
    );
  });

  it('limits 20 calls a minute per token', async () => {
    const admin = await feedAdmin(test.deps.db);
    const path = await feedPath(admin);
    for (let i = 0; i < 20; i++) expect((await get(path)).statusCode).toBe(200);
    const res = await get(path);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });

  it('notes last_fetched_at', async () => {
    const admin = await feedAdmin(test.deps.db);
    const path = await feedPath(admin);
    expect((await getFeed(test.deps.db, admin.id))!.lastFetchedAt).toBeNull();
    await get(path);
    expect((await getFeed(test.deps.db, admin.id))!.lastFetchedAt).toBeInstanceOf(Date);
  });

  it('needs no session and answers HEAD with the headers and no body', async () => {
    const admin = await feedAdmin(test.deps.db);
    const path = await feedPath(admin);
    const head = await test.app.inject({
      method: 'HEAD',
      url: path,
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-type']).toBe('text/calendar; charset=utf-8');
  });

  it('never logs the feed token', async () => {
    const admin = await feedAdmin(test.deps.db);
    const path = await feedPath(admin);
    const token = path.split('/')[4]!;
    logLines.length = 0;
    expect((await get(path)).statusCode).toBe(200);
    await get(path.replace('help.ics', 'other'));
    const log = logLines.join('\n');
    expect(log).toContain('/api/public/calendar/:token/help.ics');
    expect(log).not.toContain(token);
  });
});
