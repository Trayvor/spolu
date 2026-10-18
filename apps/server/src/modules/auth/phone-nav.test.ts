import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { user } from '../users/schema.js';

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

async function signedIn() {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await test.deps.db
    .insert(user)
    .values({ id, email, name: 'Nav', role: 'client', emailVerified: true });
  return { id, cookie: await loginAs(app, email) };
}

const getMe = (cookie: string) => app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
const put = (cookie: string | undefined, payload: object) =>
  app.inject({
    method: 'PUT',
    url: '/api/me/phone-nav',
    headers: cookie ? { cookie } : {},
    payload,
  });

describe('PUT /api/me/phone-nav', () => {
  it('defaults to classic and stores the choice, which /api/me reports', async () => {
    const a = await signedIn();
    expect((await getMe(a.cookie)).json()).toMatchObject({ phoneNav: 'classic' });
    expect((await put(a.cookie, { phoneNav: 'bottom' })).statusCode).toBe(204);
    expect((await getMe(a.cookie)).json()).toMatchObject({ phoneNav: 'bottom' });
    expect((await put(a.cookie, { phoneNav: 'classic' })).statusCode).toBe(204);
    expect((await getMe(a.cookie)).json()).toMatchObject({ phoneNav: 'classic' });
  });

  it('changes only the caller', async () => {
    const a = await signedIn();
    const b = await signedIn();
    await put(a.cookie, { phoneNav: 'bottom' });
    expect((await getMe(b.cookie)).json()).toMatchObject({ phoneNav: 'classic' });
    const [row] = await test.deps.db.select().from(user).where(eq(user.id, a.id));
    expect(row?.phoneNav).toBe('bottom');
  });

  it('rejects an unknown value and needs a session', async () => {
    const a = await signedIn();
    expect((await put(a.cookie, { phoneNav: 'tabs' })).statusCode).toBe(400);
    expect((await put(a.cookie, {})).statusCode).toBe(400);
    expect((await put(undefined, { phoneNav: 'bottom' })).statusCode).toBe(401);
  });
});
