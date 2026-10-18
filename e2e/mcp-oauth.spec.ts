import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { SUPERADMIN_EMAIL } from './env';
import { clearMailFor, latestLoginCode } from './mailpit';

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

// The whole custom-connector flow as Claude runs it (ADR 0034): register, send the admin to the
// consent page, log in there, approve, catch the redirect to claude.ai, exchange the code with
// PKCE, call /mcp with the access token.
test('Claude connects as a custom connector: login, consent, code, token, /mcp', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const page = await context.newPage();
  const request = context.request;

  const metadata = await request.get('/.well-known/oauth-authorization-server');
  expect(metadata.ok()).toBe(true);
  const { registration_endpoint, authorization_endpoint, token_endpoint } = await metadata.json();
  expect(authorization_endpoint).toBe(`${baseURL}/oauth/authorize`);

  const registered = await request.post(registration_endpoint, {
    data: {
      client_name: 'Claude',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  });
  expect(registered.status()).toBe(201);
  const { client_id } = await registered.json();

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: CALLBACK,
    state: '12345',
    scope: 'read write',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${baseURL}/mcp`,
  });

  // Claude's callback is not reached for real: catch where the browser is sent.
  let landed: string | null = null;
  await context.route('https://claude.ai/**', async (route) => {
    landed = route.request().url();
    await route.fulfill({ status: 200, body: 'ok' });
  });

  await clearMailFor(request, SUPERADMIN_EMAIL);
  const first = await page.goto(`/oauth/authorize?${query.toString()}`);
  expect(first?.headers()['x-frame-options']).toBe('DENY');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await page.getByLabel('E-mail').fill(SUPERADMIN_EMAIL);
  await page.getByRole('button', { name: 'Poslať kód' }).click();
  await page.getByLabel('Kód').fill(await latestLoginCode(request, SUPERADMIN_EMAIL));

  // Back on the consent page with the query exactly as sent (state "12345" stays a string).
  await expect(
    page.getByRole('heading', { name: 'Claude chce používať Help vo vašom mene' }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe(`?${query.toString()}`);
  await expect(page.getByText('Po vašej odpovedi sa vrátite na claude.ai.')).toBeVisible();
  await expect(page.getByLabel(/Čítanie a zmeny/)).toBeChecked();
  await page.getByLabel(/Len čítanie/).check();
  await page.getByRole('button', { name: 'Povoliť prístup' }).click();

  await expect.poll(() => landed).not.toBeNull();
  const back = new URL(landed!);
  expect(back.searchParams.get('state')).toBe('12345');
  const code = back.searchParams.get('code');
  expect(code).toBeTruthy();

  const tokens = await request.post(token_endpoint, {
    form: {
      grant_type: 'authorization_code',
      client_id,
      code: code!,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      resource: `${baseURL}/mcp`,
    },
  });
  expect(tokens.status()).toBe(200);
  const { access_token, scope } = await tokens.json();
  expect(scope).toBe('read');

  const list = await request.post('/mcp', {
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(list.status()).toBe(200);
  const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain('whoami');
  expect(names).not.toContain('create_task');

  // The connection is on the settings card and can be disconnected there.
  await page.goto('/settings');
  await expect(page.getByText('Len čítanie, claude.ai')).toBeVisible();
  await page.getByRole('button', { name: 'Odpojiť', exact: true }).click();
  await page.getByRole('button', { name: 'Odpojiť asistenta' }).click();
  await expect(page.getByText('Zatiaľ nie je pripojený žiadny asistent.')).toBeVisible();
  const after = await request.post('/mcp', {
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: 2, method: 'ping' },
  });
  expect(after.status()).toBe(401);
  await context.close();
});
