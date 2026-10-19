import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { feedAdmin } from '../../../test/calendar.js';
import { deactivateUser } from '../users/service.js';
import {
  deleteFeedOf,
  findFeedByToken,
  getFeed,
  putFeed,
  rotateFeed,
  toFeedDto,
  touchFetched,
} from './service.js';
import { feedToken } from './token.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const secret = 's'.repeat(32);
const include = { events: true, tasks: true, calls: true };

describe('calendar feed settings (ADR 0051)', () => {
  let userId: string;
  beforeEach(async () => {
    userId = (await feedAdmin(db, 'Feed Owner')).id;
  });

  it('creates once, then only changes the switches', async () => {
    const a = await putFeed(db, secret, userId, include);
    const b = await putFeed(db, secret, userId, { events: false, tasks: false, calls: true });
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.row.nonce).toBe(a.row.nonce);
    expect(b.row.tokenHash).toBe(a.row.tokenHash);
    expect(b.row).toMatchObject({ includeEvents: false, includeTasks: false, includeCalls: true });
  });

  it('stores the hash, never the token, and finds the row by the token', async () => {
    const { row } = await putFeed(db, secret, userId, include);
    const token = feedToken(secret, userId, row.nonce);
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await findFeedByToken(db, secret, token))?.userId).toBe(userId);
    expect(await findFeedByToken(db, 'other'.repeat(8), token)).toBeNull();
    expect(await findFeedByToken(db, secret, 'abc')).toBeNull();
  });

  it('rotate replaces the token; the old one no longer resolves', async () => {
    const { row } = await putFeed(db, secret, userId, include);
    const old = feedToken(secret, userId, row.nonce);
    const rotated = await rotateFeed(db, secret, userId);
    expect(rotated!.nonce).not.toBe(row.nonce);
    expect(await findFeedByToken(db, secret, old)).toBeNull();
    const fresh = feedToken(secret, userId, rotated!.nonce);
    expect((await findFeedByToken(db, secret, fresh))?.userId).toBe(userId);
    expect(await rotateFeed(db, secret, (await feedAdmin(db)).id)).toBeNull();
  });

  it('touches last_fetched_at at most once an hour', async () => {
    await putFeed(db, secret, userId, include);
    const t0 = new Date('2026-10-19T10:00:00.000Z');
    await touchFetched(db, userId, t0);
    await touchFetched(db, userId, new Date(t0.getTime() + 30 * 60_000));
    expect((await getFeed(db, userId))!.lastFetchedAt).toEqual(t0);
    const later = new Date(t0.getTime() + 61 * 60_000);
    await touchFetched(db, userId, later);
    expect((await getFeed(db, userId))!.lastFetchedAt).toEqual(later);
  });

  it('revoke deletes the row', async () => {
    await putFeed(db, secret, userId, include);
    expect(await deleteFeedOf(db, userId)).toBe(true);
    expect(await getFeed(db, userId)).toBeNull();
    expect(await deleteFeedOf(db, userId)).toBe(false);
  });

  it('deactivateUser deletes the feed', async () => {
    await putFeed(db, secret, userId, include);
    await deactivateUser(db, userId);
    expect(await getFeed(db, userId)).toBeNull();
  });

  it('the DTO derives the URL, its webcal form and the Google link', async () => {
    const { row } = await putFeed(db, secret, userId, include);
    const dto = toFeedDto(row, 'https://help.example/', secret);
    const token = feedToken(secret, userId, row.nonce);
    expect(dto.url).toBe(`https://help.example/api/public/calendar/${token}/help.ics`);
    expect(dto.webcalUrl).toBe(`webcal://help.example/api/public/calendar/${token}/help.ics`);
    expect(dto.googleUrl).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(dto.webcalUrl)}`,
    );
    expect(dto).toMatchObject({ include, lastFetchedAt: null });
  });
});
