import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { MeSchema, type Role } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { countEmailsTo, latestEmail, latestLoginCode } from '../../../test/mailpit.js';
import { user } from '../users/schema.js';
import { verification } from './schema.js';

let test: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;

beforeAll(async () => {
  test = await buildTestApp();
  app = test.app;
});
afterAll(async () => {
  await app.close();
  await test.close();
});

const uniqueEmail = (): string => `${randomUUID()}@example.com`;

async function createUser(role: Role = 'admin') {
  const email = uniqueEmail();
  const id = randomUUID();
  await test.deps.db
    .insert(user)
    .values({ id, email, name: `User ${id}`, role, emailVerified: true });
  return { id, email };
}

async function signedIn(role: Role = 'admin') {
  const created = await createUser(role);
  return { ...created, cookie: await loginAs(app, created.email) };
}

const requestChange = (cookie: string | undefined, newEmail: string) =>
  app.inject({
    method: 'POST',
    url: '/api/me/email-change',
    headers: cookie ? { cookie } : {},
    payload: { newEmail },
  });

const confirmChange = (cookie: string | undefined, newEmail: string, code: string) =>
  app.inject({
    method: 'POST',
    url: '/api/me/email-change/confirm',
    headers: cookie ? { cookie } : {},
    payload: { newEmail, code },
  });

const getMe = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });

const wrongCode = (right: string): string => (right === '000000' ? '111111' : '000000');

/** Polls Mailpit until the newest email to `email` matches `subject`. */
async function waitForSubject(email: string, subject: RegExp, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const caught = await latestEmail(email, timeoutMs);
    if (subject.test(caught.subject)) return caught;
    if (Date.now() > deadline) throw new Error(`No email "${subject}" to ${email}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('email change', () => {
  it('the code goes to the new address and the change applies', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();

    const sent = await requestChange(a.cookie, newEmail);
    expect(sent.statusCode).toBe(204);
    const codeEmail = await latestEmail(newEmail);
    // Default stored language: Slovak.
    expect(codeEmail.subject).toMatch(/^Kód na zmenu e-mailu v Spolu: \d{6}$/);
    const code = await latestLoginCode(newEmail);

    const res = await confirmChange(a.cookie, newEmail, code);
    expect(res.statusCode).toBe(200);
    expect(MeSchema.strict().parse(res.json())).toEqual({
      id: a.id,
      email: newEmail,
      name: `User ${a.id}`,
      role: 'admin',
      groupId: null,
    });

    const me = await getMe(a.cookie);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: a.id, email: newEmail });

    const notice = await waitForSubject(a.email, /^Váš e-mail v Spolu bol zmenený$/);
    expect(notice.text).toContain(newEmail);

    // The request is used up.
    const rows = await test.deps.db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `email-change:${a.id}`));
    expect(rows).toHaveLength(0);
  });

  it('existing sessions stay valid and the new address logs in', async () => {
    const a = await createUser();
    const first = await loginAs(app, a.email);
    const second = await loginAs(app, a.email);
    const newEmail = uniqueEmail();
    await requestChange(first, newEmail);
    const res = await confirmChange(first, newEmail, await latestLoginCode(newEmail));
    expect(res.statusCode).toBe(200);

    expect((await getMe(first)).json()).toMatchObject({ email: newEmail });
    expect((await getMe(second)).json()).toMatchObject({ email: newEmail });
    const fresh = await loginAs(app, newEmail);
    expect((await getMe(fresh)).json()).toMatchObject({ id: a.id });
  });

  it('stores the new address lowercase', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    const typed = `  ${newEmail.toUpperCase()} `;
    expect((await requestChange(a.cookie, typed)).statusCode).toBe(204);
    const code = await latestLoginCode(newEmail);
    const res = await confirmChange(a.cookie, newEmail.toUpperCase(), code);
    expect(res.statusCode).toBe(200);
    const [row] = await test.deps.db.select().from(user).where(eq(user.id, a.id));
    expect(row?.email).toBe(newEmail);
  });

  it('stores the code hashed, bound to the user and the address', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const code = await latestLoginCode(newEmail);
    const [row] = await test.deps.db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `email-change:${a.id}`));
    expect(row?.value).toMatch(new RegExp(`^[0-9a-f]{64}:${newEmail}:0$`));
    expect(row?.value).not.toContain(code);
    const lifeMs = row!.expiresAt.getTime() - Date.now();
    expect(lifeMs).toBeGreaterThan(290_000);
    expect(lifeMs).toBeLessThanOrEqual(300_000);
  });

  it('queues the code email with the short login-code options', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    const send = vi.spyOn(test.deps.jobs, 'send');
    await requestChange(a.cookie, newEmail);
    expect(send).toHaveBeenCalledWith(
      'email.send',
      expect.objectContaining({ to: [newEmail] }),
      expect.objectContaining({ expireInSeconds: 240, deleteAfterSeconds: 60 }),
    );
    send.mockRestore();
  });

  it('a wrong code answers invalid_code and the email stays', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const right = await latestLoginCode(newEmail);
    const res = await confirmChange(a.cookie, newEmail, wrongCode(right));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
    expect((await getMe(a.cookie)).json()).toMatchObject({ email: a.email });
    // One wrong try does not use the request up.
    expect((await confirmChange(a.cookie, newEmail, right)).statusCode).toBe(200);
  });

  it('three wrong codes use the request up', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const right = await latestLoginCode(newEmail);
    for (let i = 0; i < 3; i++) {
      const res = await confirmChange(a.cookie, newEmail, wrongCode(right));
      expect(res.json()).toEqual({ error: 'invalid_code' });
    }
    const res = await confirmChange(a.cookie, newEmail, right);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
    expect((await getMe(a.cookie)).json()).toMatchObject({ email: a.email });
  });

  it('parallel wrong codes cannot get past the attempt limit', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const right = await latestLoginCode(newEmail);
    await Promise.all(
      Array.from({ length: 6 }, () => confirmChange(a.cookie, newEmail, wrongCode(right))),
    );
    const [row] = await test.deps.db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `email-change:${a.id}`));
    expect(row?.value.endsWith(':3')).toBe(true);
    expect((await confirmChange(a.cookie, newEmail, right)).statusCode).toBe(400);
  });

  it('an expired code answers invalid_code', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const code = await latestLoginCode(newEmail);
    await test.deps.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `email-change:${a.id}`));
    const res = await confirmChange(a.cookie, newEmail, code);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
    expect((await getMe(a.cookie)).json()).toMatchObject({ email: a.email });
  });

  it('confirming without a request answers invalid_code', async () => {
    const a = await signedIn();
    const res = await confirmChange(a.cookie, uniqueEmail(), '123456');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
  });

  it('the code works only for the address it was sent to', async () => {
    const a = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const code = await latestLoginCode(newEmail);
    const other = uniqueEmail();
    const res = await confirmChange(a.cookie, other, code);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
    expect((await getMe(a.cookie)).json()).toMatchObject({ email: a.email });
  });

  it('a new request replaces the earlier one', async () => {
    const a = await signedIn();
    const firstEmail = uniqueEmail();
    await requestChange(a.cookie, firstEmail);
    const firstCode = await latestLoginCode(firstEmail);
    const secondEmail = uniqueEmail();
    await requestChange(a.cookie, secondEmail);
    const secondCode = await latestLoginCode(secondEmail);

    expect((await confirmChange(a.cookie, firstEmail, firstCode)).statusCode).toBe(400);
    const rows = await test.deps.db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `email-change:${a.id}`));
    expect(rows).toHaveLength(1);
    expect((await confirmChange(a.cookie, secondEmail, secondCode)).statusCode).toBe(200);
  });

  it('an address of another account answers email_taken only after the code', async () => {
    const a = await signedIn();
    const b = await createUser('client');
    const sent = await requestChange(a.cookie, b.email);
    expect(sent.statusCode).toBe(204);
    const code = await latestLoginCode(b.email);

    const res = await confirmChange(a.cookie, b.email, code);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'email_taken' });
    expect((await getMe(a.cookie)).json()).toMatchObject({ email: a.email });
    const [row] = await test.deps.db.select().from(user).where(eq(user.id, b.id));
    expect(row?.email).toBe(b.email);
  });

  it('a taken address in another case still answers email_taken', async () => {
    const a = await signedIn();
    const b = await createUser('admin');
    await requestChange(a.cookie, b.email.toUpperCase());
    const code = await latestLoginCode(b.email);
    const res = await confirmChange(a.cookie, b.email.toUpperCase(), code);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'email_taken' });
  });

  it('the same address answers validation_failed', async () => {
    const a = await signedIn();
    for (const same of [a.email, a.email.toUpperCase()]) {
      const res = await requestChange(a.cookie, same);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
    expect(await countEmailsTo(a.email)).toBe(1); // only the login code
  });

  it('an invalid address or body answers validation_failed', async () => {
    const a = await signedIn();
    for (const payload of [{ newEmail: 'not-an-email' }, {}, { newEmail: 42 }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/me/email-change',
        headers: { cookie: a.cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
    const bad = await confirmChange(a.cookie, uniqueEmail(), '12345');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'validation_failed' });
  });

  it('the 11th request in a minute answers rate_limited', async () => {
    const a = await signedIn();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await requestChange(a.cookie, uniqueEmail())).statusCode);
    }
    expect(statuses).toEqual([...Array<number>(10).fill(204), 429]);
    const res = await requestChange(a.cookie, uniqueEmail());
    expect(res.json()).toEqual({ error: 'rate_limited' });
    // The limit is per user: someone else is not affected.
    const b = await signedIn();
    expect((await requestChange(b.cookie, uniqueEmail())).statusCode).toBe(204);
  });

  it('confirm acts only on the caller', async () => {
    const a = await signedIn();
    const b = await signedIn();
    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    const code = await latestLoginCode(newEmail);

    const res = await confirmChange(b.cookie, newEmail, code);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_code' });
    expect((await getMe(b.cookie)).json()).toMatchObject({ email: b.email });
    // A's request is untouched.
    expect((await confirmChange(a.cookie, newEmail, code)).statusCode).toBe(200);
  });

  it('needs a session', async () => {
    expect((await requestChange(undefined, uniqueEmail())).statusCode).toBe(401);
    expect((await confirmChange(undefined, uniqueEmail(), '123456')).statusCode).toBe(401);
    const lang = await app.inject({
      method: 'PUT',
      url: '/api/me/language',
      payload: { language: 'en' },
    });
    expect(lang.statusCode).toBe(401);
  });
});

describe('language', () => {
  const putLanguage = (cookie: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/api/me/language',
      headers: { cookie },
      payload: payload as object,
    });

  it('language is stored and used for the next email', async () => {
    const a = await signedIn('client');
    const res = await putLanguage(a.cookie, { language: 'en' });
    expect(res.statusCode).toBe(204);
    const [row] = await test.deps.db.select().from(user).where(eq(user.id, a.id));
    expect(row?.language).toBe('en');

    const newEmail = uniqueEmail();
    await requestChange(a.cookie, newEmail);
    expect((await latestEmail(newEmail)).subject).toMatch(/^Your Spolu email change code: \d{6}$/);
    const code = await latestLoginCode(newEmail);
    expect((await confirmChange(a.cookie, newEmail, code)).statusCode).toBe(200);
    const notice = await waitForSubject(a.email, /^Your Spolu email was changed$/);
    expect(notice.text).toContain(newEmail);
  });

  it('an unknown language answers validation_failed', async () => {
    const a = await signedIn();
    for (const payload of [{ language: 'de' }, {}]) {
      const res = await putLanguage(a.cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
  });
});
