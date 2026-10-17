import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Role } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { cookieHeader, loginAs } from '../../../test/login.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { session, ticketSignInLinks } from './schema.js';
import {
  createTicketLink,
  deleteExpiredTicketLinks,
  TICKET_LINK_TTL_MS,
  ticketEmailUrl,
} from './ticket-link.js';

let test: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;
const logLines: Record<string, unknown>[] = [];
const logStream = { write: (line: string) => void logLines.push(JSON.parse(line)) };
let ip = 0;

beforeAll(async () => {
  test = await buildTestApp({ logStream });
  app = test.app;
});
afterAll(async () => {
  await app.close();
  await test.close();
});

const db = () => test.deps.db;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function createUser(
  role: Role = 'client',
  opts: { name?: string; verified?: boolean; disabled?: boolean } = {},
) {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await db()
    .insert(user)
    .values({
      id,
      email,
      name: opts.name ?? '',
      role,
      emailVerified: opts.verified ?? false,
      disabledAt: opts.disabled ? new Date() : null,
    });
  return { id, email };
}

async function createTicketRow(): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  // Resolved: an active ticket without a client would crowd the admin dashboards of other test files.
  await db()
    .insert(tickets)
    .values({ id, source: 'manual', status: 'resolved', createdAt: now, updatedAt: now });
  return id;
}

async function linkFor(role: Role = 'client', opts: Parameters<typeof createUser>[1] = {}) {
  const owner = await createUser(role, opts);
  const ticketId = await createTicketRow();
  const token = await createTicketLink(db(), { userId: owner.id, ticketId });
  return { owner, ticketId, token };
}

/** Every call from its own address unless `from` is given: the per-address limit stays out of the way. */
const useLink = (token: string, opts: { cookie?: string; from?: string } = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/ticket-link/sign-in',
    remoteAddress: opts.from ?? `10.7.${Math.floor(++ip / 250)}.${ip % 250}`,
    // A browser sends its Origin; better-auth refuses a cookie-carrying POST without one.
    headers: opts.cookie ? { cookie: opts.cookie, origin: 'http://localhost:3000' } : {},
    payload: { token },
  });

const me = (cookie: string) => app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });

const sessionsOf = async (userId: string) =>
  db().select().from(session).where(eq(session.userId, userId));

describe('ticket links: the token', () => {
  it('is long and random, and only its SHA-256 hash is stored', async () => {
    const { owner, ticketId, token } = await linkFor();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const rows = await db()
      .select()
      .from(ticketSignInLinks)
      .where(eq(ticketSignInLinks.userId, owner.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tokenHash: sha256(token), ticketId, lastUsedAt: null });
    expect(JSON.stringify(rows[0])).not.toContain(token);
    const life = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(Math.abs(life - TICKET_LINK_TTL_MS)).toBeLessThan(60_000);
  });

  it('the email URL is the link page for a client, the login page for an admin', async () => {
    const client = await createUser('client');
    const admin = await createUser('admin');
    const ticketId = await createTicketRow();
    const base = 'https://help.example.sk';
    const forClient = await ticketEmailUrl(db(), base, { ...client, role: 'client' }, ticketId);
    expect(forClient.oneClick).toBe(true);
    expect(forClient.url).toMatch(/^https:\/\/help\.example\.sk\/t#[A-Za-z0-9_-]{43,}$/);
    const forAdmin = await ticketEmailUrl(db(), base, { ...admin, role: 'admin' }, ticketId);
    expect(forAdmin.oneClick).toBe(false);
    expect(forAdmin.url).toBe(
      `${base}/login?redirect=${encodeURIComponent(`/tickets/${ticketId}`)}&email=${encodeURIComponent(admin.email)}`,
    );
    const adminLinks = await db()
      .select()
      .from(ticketSignInLinks)
      .where(eq(ticketSignInLinks.userId, admin.id));
    expect(adminLinks).toHaveLength(0);
  });

  it('the daily cleanup deletes expired links only', async () => {
    const live = await linkFor();
    const old = await linkFor();
    await db()
      .update(ticketSignInLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ticketSignInLinks.userId, old.owner.id));
    expect(await deleteExpiredTicketLinks(db())).toBeGreaterThanOrEqual(1);
    const left = await db().select({ userId: ticketSignInLinks.userId }).from(ticketSignInLinks);
    expect(left.map((r) => r.userId)).toContain(live.owner.id);
    expect(left.map((r) => r.userId)).not.toContain(old.owner.id);
  });
});

describe('ticket links: signing in', () => {
  it('signs a client in, answers the ticket and marks the email verified', async () => {
    const { owner, ticketId, token } = await linkFor('client', { name: '' });
    const res = await useLink(token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ticketId });
    const cookie = cookieHeader(res);
    expect(cookie).toContain('better-auth.session_token=');
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');

    const who = await me(cookie);
    expect(who.statusCode).toBe(200);
    expect(who.json()).toMatchObject({ id: owner.id, name: '', role: 'client' });

    const [row] = await db().select().from(user).where(eq(user.id, owner.id));
    expect(row!.emailVerified).toBe(true);
    const [link] = await db()
      .select()
      .from(ticketSignInLinks)
      .where(eq(ticketSignInLinks.userId, owner.id));
    expect(link!.lastUsedAt).not.toBeNull();

    // The same session lifetime as a code sign-in: 60 days.
    const [s] = await sessionsOf(owner.id);
    const days = (s!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59);
    expect(days).toBeLessThan(61);
  });

  it('works again within its 7 days (another device)', async () => {
    const { owner, token } = await linkFor();
    const first = await useLink(token);
    const second = await useLink(token);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(cookieHeader(second)).not.toBe(cookieHeader(first));
    expect((await me(cookieHeader(first))).statusCode).toBe(200);
    expect((await me(cookieHeader(second))).statusCode).toBe(200);
    expect(await sessionsOf(owner.id)).toHaveLength(2);
  });

  it('an expired link is refused with the email, and no session', async () => {
    const { owner, token } = await linkFor();
    await db()
      .update(ticketSignInLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(ticketSignInLinks.userId, owner.id));
    const res = await useLink(token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'TICKET_LINK_INVALID', email: owner.email });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await sessionsOf(owner.id)).toHaveLength(0);
  });

  it('an unknown token is refused the same way, without an email', async () => {
    const res = await useLink('x'.repeat(43));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'TICKET_LINK_INVALID' });
    expect(res.json()).not.toHaveProperty('email');
    expect((await useLink('')).statusCode).toBe(400);
  });

  it('never signs an admin in, even one who became an admin after the email', async () => {
    const { owner, token } = await linkFor('client');
    await db().update(user).set({ role: 'admin' }).where(eq(user.id, owner.id));
    const res = await useLink(token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'TICKET_LINK_INVALID', email: owner.email });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await sessionsOf(owner.id)).toHaveLength(0);

    const superadmin = await linkFor('superadmin');
    expect((await useLink(superadmin.token)).statusCode).toBe(400);
    expect(await sessionsOf(superadmin.owner.id)).toHaveLength(0);
  });

  it('never signs a deactivated user in', async () => {
    const { owner, token } = await linkFor('client');
    await db().update(user).set({ disabledAt: new Date() }).where(eq(user.id, owner.id));
    const res = await useLink(token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'TICKET_LINK_INVALID' });
    expect(res.json()).not.toHaveProperty('email');
    expect(await sessionsOf(owner.id)).toHaveLength(0);
  });

  it('signed in as the same user: keeps that session, makes no new one', async () => {
    const { owner, ticketId, token } = await linkFor('client', { verified: true, name: 'Jana' });
    const cookie = await loginAs(app, owner.email);
    expect(await sessionsOf(owner.id)).toHaveLength(1);
    const res = await useLink(token, { cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ticketId });
    expect(await sessionsOf(owner.id)).toHaveLength(1);
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('signed in as someone else: ends that session, then signs the link user in', async () => {
    const other = await createUser('client', { verified: true, name: 'Other' });
    const otherCookie = await loginAs(app, other.email);
    const { owner, token } = await linkFor();
    const res = await useLink(token, { cookie: otherCookie });
    expect(res.statusCode).toBe(200);
    expect((await me(otherCookie)).statusCode).toBe(401);
    expect(await sessionsOf(other.id)).toHaveLength(0);
    expect((await me(cookieHeader(res))).json()).toMatchObject({ id: owner.id });
  });

  it('an admin signed in elsewhere is not signed out by a refused link', async () => {
    const admin = await createUser('admin', { verified: true, name: 'Ad' });
    const adminCookie = await loginAs(app, admin.email);
    const res = await useLink('y'.repeat(43), { cookie: adminCookie });
    expect(res.statusCode).toBe(400);
    expect((await me(adminCookie)).statusCode).toBe(200);
  });

  it('is limited per address: the 11th try in a minute is 429', async () => {
    const from = '10.99.0.1';
    for (let i = 0; i < 10; i++) {
      expect((await useLink('z'.repeat(43), { from })).statusCode).toBe(400);
    }
    const { token } = await linkFor();
    expect((await useLink(token, { from })).statusCode).toBe(429);
    expect((await useLink(token)).statusCode).toBe(200); // another address
  });

  it('logs only a prefix of the token hash, never the token', async () => {
    const { token } = await linkFor();
    logLines.length = 0;
    expect((await useLink(token)).statusCode).toBe(200);
    const log = logLines.map((l) => JSON.stringify(l)).join('\n');
    expect(log).not.toContain(token);
    expect(log).not.toContain(sha256(token));
    expect(log).toContain(sha256(token).slice(0, 12));
  });
});
