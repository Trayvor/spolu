import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { McpConnection, McpConsentInfo, McpToken } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { mcpRequest } from '../../../test/mcp.js';
import { createGroup } from '../groups/service.js';
import { addMembership } from '../groups/memberships.js';
import { latestEmail } from '../../../test/mailpit.js';
import { serverTexts } from '../../infra/i18n/index.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setUserLanguage,
} from '../users/service.js';
import { mcpOAuthClients, mcpOAuthCodes, mcpTokens } from './schema.js';

/**
 * OAuth for the MCP server (ADR 0034, spec 2026-10-18-mcp-oauth-design.md), test-first: the
 * metadata, dynamic registration, the consent API, the token endpoint and revocation, and that
 * an OAuth access token goes through the same `/mcp` checks as a personal token.
 */

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const ORIGIN = 'http://localhost:3000';
const RESOURCE = `${ORIGIN}/mcp`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const b64url = (buf: Buffer) => buf.toString('base64url');
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

type Tokens = { access_token: string; refresh_token: string; scope: string; expires_in: number };

describe('MCP OAuth', () => {
  let test: TestApp;
  let admin: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let clientCookie: string;
  const admins: string[] = [];

  const newAdmin = async () => {
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Ada' });
    admins.push(row.id);
    return { id: row.id, cookie: await loginAs(test.app, email) };
  };

  // A fresh address by default: the registration limit is per address.
  const register = (body: Record<string, unknown> = {}, ip = `10.1.${randomBytes(2).join('.')}`) =>
    test.app.inject({
      method: 'POST',
      url: '/oauth/register',
      remoteAddress: ip,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: [CALLBACK],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...body,
      }),
    });

  const newClient = async (body: Record<string, unknown> = {}) => {
    const res = await register(body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ client_id: string; client_secret?: string }>();
  };

  const params = (clientId: string, challenge: string, extra: Record<string, string> = {}) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    state: 'st4te',
    scope: 'read write',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    ...extra,
  });

  const consentInfo = (cookie: string | null, query: Record<string, string>) =>
    test.app.inject({
      method: 'GET',
      url: `/api/oauth/authorize?${new URLSearchParams(query).toString()}`,
      headers: cookie ? { cookie } : {},
    });

  const decide = (
    cookie: string,
    query: Record<string, string>,
    consentToken: string,
    approve: boolean,
    scope: 'read' | 'write' = 'write',
    headers: Record<string, string> = {},
  ) =>
    test.app.inject({
      method: 'POST',
      url: '/api/oauth/authorize',
      headers: { cookie, 'content-type': 'application/json', ...headers },
      payload: JSON.stringify({ params: query, consentToken, approve, scope }),
    });

  const tokenRequest = (form: Record<string, string>, headers: Record<string, string> = {}) =>
    test.app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      payload: new URLSearchParams(form).toString(),
    });

  /** Consent approved: the code from the redirect address. */
  async function approvedCode(
    cookie: string,
    clientId: string,
    challenge: string,
    scope: 'read' | 'write' = 'write',
    extra: Record<string, string> = {},
  ) {
    const query = params(clientId, challenge, extra);
    const info = await consentInfo(cookie, query);
    expect(info.statusCode, info.body).toBe(200);
    const body = info.json<McpConsentInfo>();
    if (body.kind !== 'consent') throw new Error(`no consent: ${info.body}`);
    const res = await decide(cookie, query, body.consentToken, true, scope);
    expect(res.statusCode, res.body).toBe(200);
    const target = new URL(res.json<{ redirectTo: string }>().redirectTo);
    expect(`${target.origin}${target.pathname}`).toBe(extra.redirect_uri ?? CALLBACK);
    expect(target.searchParams.get('state')).toBe('st4te');
    expect(target.searchParams.get('iss')).toBe(ORIGIN);
    return target.searchParams.get('code')!;
  }

  const exchange = (clientId: string, code: string, verifier: string, extra = {}) =>
    tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      resource: RESOURCE,
      ...extra,
    });

  /** The whole flow: a registered client, an approved consent, the first tokens. */
  async function connect(cookie: string, scope: 'read' | 'write' = 'write') {
    const { client_id } = await newClient();
    const { verifier, challenge } = pkce();
    const code = await approvedCode(cookie, client_id, challenge, scope);
    const res = await exchange(client_id, code, verifier);
    expect(res.statusCode, res.body).toBe(200);
    return { clientId: client_id, ...res.json<Tokens>() };
  }

  const refresh = (clientId: string, refreshToken: string) =>
    tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });

  const mcpStatus = async (token: string) =>
    (await mcpRequest(test.app, token, 'tools/list')).statusCode;

  beforeAll(async () => {
    test = await buildTestApp();
    admin = await newAdmin();
    other = await newAdmin();
    const group = await createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const email = `${randomUUID()}@example.com`;
    const client = await createUnverifiedClient(test.deps.db, email, 'Cyril');
    await addMembership(test.deps.db, client.id, group.id, 'client');
    clientCookie = await loginAs(test.app, email);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  describe('metadata', () => {
    it('serves the protected resource metadata (RFC 9728) at both well-known paths', async () => {
      for (const url of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ]) {
        const res = await test.app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.json()).toMatchObject({
          resource: RESOURCE,
          authorization_servers: [ORIGIN],
          scopes_supported: ['read', 'write'],
          bearer_methods_supported: ['header'],
        });
      }
    });

    it('serves the authorization server metadata (RFC 8414): code flow, S256 only', async () => {
      const res = await test.app.inject({
        method: 'GET',
        url: '/.well-known/oauth-authorization-server',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/oauth/authorize`,
        token_endpoint: `${ORIGIN}/oauth/token`,
        registration_endpoint: `${ORIGIN}/oauth/register`,
        revocation_endpoint: `${ORIGIN}/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
      });
    });

    it('answers 401 from /mcp with the resource metadata address', async () => {
      const res = await mcpRequest(test.app, null, 'ping');
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain(
        `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
      );
      const wrong = await mcpRequest(test.app, 'spolu_mcp_nope', 'ping');
      expect(wrong.headers['www-authenticate']).toContain('error="invalid_token"');
    });
  });

  describe('dynamic client registration', () => {
    it('registers a public client and a client with a secret', async () => {
      const res = await register();
      expect(res.statusCode, res.body).toBe(201);
      const body = res.json();
      expect(body).toMatchObject({
        client_name: 'Claude',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      });
      expect(body.client_id).toEqual(expect.any(String));
      expect(body.client_secret).toBeUndefined();

      const secret = await register({ token_endpoint_auth_method: 'client_secret_post' });
      expect(secret.statusCode).toBe(201);
      expect(secret.json().client_secret).toEqual(expect.any(String));
      const [row] = await test.deps.db
        .select()
        .from(mcpOAuthClients)
        .where(eq(mcpOAuthClients.id, secret.json().client_id));
      expect(row!.secretHash).not.toBe(secret.json().client_secret);
    });

    it.each([
      'http://localhost:33418/callback',
      'http://127.0.0.1/callback',
      'http://[::1]:8080/cb',
      'https://claude.com/api/mcp/auth_callback',
    ])('accepts %s', async (uri) => {
      expect((await register({ redirect_uris: [uri] })).statusCode).toBe(201);
    });

    it.each([
      ['a foreign host', 'https://evil.example/callback'],
      ['a look-alike host', 'https://claude.ai.evil.example/callback'],
      ['a subdomain', 'https://x.claude.ai/callback'],
      ['user info', 'https://claude.ai@evil.example/callback'],
      ['plain http', 'http://claude.ai/api/mcp/auth_callback'],
      ['a fragment', `${CALLBACK}#x`],
      ['a custom scheme', 'claude://callback'],
      ['javascript', 'javascript:alert(1)'],
      ['not a URL', 'callback'],
    ])('refuses %s', async (_label, uri) => {
      const res = await register({ redirect_uris: [uri] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_redirect_uri');
    });

    it('refuses no redirect address, too many, and an unsupported grant or method', async () => {
      expect((await register({ redirect_uris: [] })).statusCode).toBe(400);
      expect((await register({ redirect_uris: Array(6).fill(CALLBACK) })).statusCode).toBe(400);
      expect((await register({ grant_types: ['client_credentials'] })).json().error).toBe(
        'invalid_client_metadata',
      );
      expect((await register({ token_endpoint_auth_method: 'private_key_jwt' })).statusCode).toBe(
        400,
      );
    });

    it('limits registrations per address', async () => {
      const ip = '10.9.9.9';
      let status = 0;
      for (let i = 0; i < 31 && status !== 429; i += 1)
        status = (await register({}, ip)).statusCode;
      expect(status).toBe(429);
      expect((await register({}, '10.9.9.10')).statusCode).toBe(201);
    });
  });

  describe('consent', () => {
    it('shows the client name, the redirect host and the scope asked for', async () => {
      const { client_id } = await newClient({ client_name: 'Claude' });
      const res = await consentInfo(admin.cookie, params(client_id, pkce().challenge));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        kind: 'consent',
        clientName: 'Claude',
        redirectHost: 'claude.ai',
        requestedScope: 'write',
        limitReached: false,
      });
      const read = await consentInfo(
        admin.cookie,
        params(client_id, pkce().challenge, { scope: 'read' }),
      );
      expect(read.json().requestedScope).toBe('read');
    });

    it('needs a session, and refuses a non-admin', async () => {
      const { client_id } = await newClient();
      const query = params(client_id, pkce().challenge);
      expect((await consentInfo(null, query)).statusCode).toBe(401);
      expect((await consentInfo(clientCookie, query)).statusCode).toBe(403);
      // A consent token is never handed to a client, and one made up gets nowhere.
      const res = await decide(clientCookie, query, 'x.y', true);
      expect(res.statusCode).toBe(403);
    });

    it('never redirects to an unknown client or an unregistered address (no open redirect)', async () => {
      const { challenge } = pkce();
      const unknown = await consentInfo(
        admin.cookie,
        params('no-such-client', challenge, { redirect_uri: 'https://evil.example/cb' }),
      );
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json()).toEqual({ error: 'invalid_client' });

      const { client_id } = await newClient();
      for (const uri of ['https://evil.example/cb', 'https://claude.ai/other', `${CALLBACK}?x=1`]) {
        const res = await consentInfo(
          admin.cookie,
          params(client_id, challenge, { redirect_uri: uri }),
        );
        expect(res.statusCode, uri).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_redirect_uri' });
        expect(res.body).not.toContain('evil');
      }
    });

    it('sends a bad request of a known client back to its own address with the error', async () => {
      const { client_id } = await newClient();
      const { challenge } = pkce();
      const cases: Array<[Record<string, string>, string]> = [
        [{ code_challenge: '' }, 'invalid_request'],
        [{ code_challenge_method: 'plain' }, 'invalid_request'],
        [{ code_challenge_method: '' }, 'invalid_request'],
        [{ code_challenge: 'short' }, 'invalid_request'],
        [{ response_type: 'token' }, 'unsupported_response_type'],
        [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
        [{ resource: `${ORIGIN}/api` }, 'invalid_target'],
        [{ scope: 'admin' }, 'invalid_scope'],
      ];
      for (const [extra, error] of cases) {
        const query = params(client_id, challenge, extra);
        for (const [key, value] of Object.entries(extra))
          if (value === '') delete query[key as keyof typeof query];
        const res = await consentInfo(admin.cookie, query);
        expect(res.statusCode, JSON.stringify(extra)).toBe(200);
        const body = res.json<McpConsentInfo>();
        expect(body.kind, JSON.stringify(extra)).toBe('redirect');
        if (body.kind !== 'redirect') continue;
        const target = new URL(body.redirectTo);
        expect(`${target.origin}${target.pathname}`).toBe(CALLBACK);
        expect(target.searchParams.get('error')).toBe(error);
        expect(target.searchParams.get('state')).toBe('st4te');
        expect(target.searchParams.get('code')).toBeNull();
      }
    });

    it('a denial goes back with access_denied and no code', async () => {
      const { client_id } = await newClient();
      const query = params(client_id, pkce().challenge);
      const info = (await consentInfo(admin.cookie, query)).json<McpConsentInfo>();
      if (info.kind !== 'consent') throw new Error('no consent');
      const res = await decide(admin.cookie, query, info.consentToken, false);
      expect(res.statusCode).toBe(200);
      const target = new URL(res.json().redirectTo);
      expect(target.searchParams.get('error')).toBe('access_denied');
      expect(target.searchParams.get('code')).toBeNull();
    });

    it('refuses a consent POST from another site, without the consent token, or with another session’s', async () => {
      const { client_id } = await newClient();
      const query = params(client_id, pkce().challenge);
      const info = (await consentInfo(admin.cookie, query)).json<McpConsentInfo>();
      if (info.kind !== 'consent') throw new Error('no consent');

      const foreign = await decide(admin.cookie, query, info.consentToken, true, 'write', {
        origin: 'https://evil.example',
      });
      expect(foreign.statusCode).toBe(403);
      const crossSite = await decide(admin.cookie, query, info.consentToken, true, 'write', {
        'sec-fetch-site': 'cross-site',
      });
      expect(crossSite.statusCode).toBe(403);
      expect((await decide(admin.cookie, query, '', true)).statusCode).toBe(403);
      // The token is bound to the session and to these parameters.
      expect((await decide(other.cookie, query, info.consentToken, true)).statusCode).toBe(403);
      const swapped = { ...query, code_challenge: pkce().challenge };
      expect((await decide(admin.cookie, swapped, info.consentToken, true)).statusCode).toBe(403);
      // A login session of the same admin is another session too.
      const second = await loginAs(
        test.app,
        (
          await test.app.inject({
            method: 'GET',
            url: '/api/me',
            headers: { cookie: admin.cookie },
          })
        ).json().email,
      );
      expect((await decide(second, query, info.consentToken, true)).statusCode).toBe(403);
      // And the real one still works.
      expect((await decide(admin.cookie, query, info.consentToken, true)).statusCode).toBe(200);
    });

    it('emails the owner when a connection is approved, with the client and its host', async () => {
      const email = `${randomUUID()}@example.com`;
      const row = await addAdmin(test.deps.db, { email, name: 'Mailed' });
      admins.push(row.id);
      await setUserLanguage(test.deps.db, row.id, 'en');
      const cookie = await loginAs(test.app, email);
      const { client_id } = await newClient({ client_name: 'Claude for Ada' });
      const code = await approvedCode(cookie, client_id, pkce().challenge);
      const t = serverTexts('en').mcp.connectionApproved;
      let caught = await latestEmail(email);
      for (let i = 0; i < 50 && caught.subject !== t.subject; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        caught = await latestEmail(email);
      }
      expect(caught.subject).toBe(t.subject);
      expect(caught.text).toContain('Claude for Ada');
      expect(caught.text).toContain('claude.ai');
      expect(caught.text).toContain(`${test.deps.config.publicUrl}/settings`);
      expect(caught.text).not.toContain(code);
    });

    it('cannot grant more than the client asked for', async () => {
      const { client_id } = await newClient();
      const query = params(client_id, pkce().challenge, { scope: 'read' });
      const info = (await consentInfo(admin.cookie, query)).json<McpConsentInfo>();
      if (info.kind !== 'consent') throw new Error('no consent');
      const res = await decide(admin.cookie, query, info.consentToken, true, 'write');
      expect(res.statusCode).toBe(400);
    });
  });

  describe('token endpoint', () => {
    it('exchanges an approved code (PKCE) for tokens that work at /mcp, no-store', async () => {
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const code = await approvedCode(admin.cookie, client_id, challenge);
      const res = await exchange(client_id, code, verifier);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json<Tokens & { token_type: string }>();
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBe(3600);
      expect(body.scope).toBe('read write');
      expect(body.access_token).toMatch(/^spolu_mcp_/);
      expect(body.refresh_token).toMatch(/^spolu_mcr_/);
      const who = await mcpRequest(test.app, body.access_token, 'tools/call', {
        name: 'whoami',
        arguments: {},
      });
      expect(who.statusCode).toBe(200);
      expect(who.body).toContain(admin.id);
      // Stored hashed only.
      const rows = await test.deps.db
        .select()
        .from(mcpTokens)
        .where(eq(mcpTokens.userId, admin.id));
      expect(JSON.stringify(rows)).not.toContain(body.access_token);
    });

    it('accepts JSON bodies too', async () => {
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const code = await approvedCode(admin.cookie, client_id, challenge);
      const res = await test.app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          grant_type: 'authorization_code',
          client_id,
          code,
          code_verifier: verifier,
          redirect_uri: CALLBACK,
        }),
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('requires and verifies PKCE', async () => {
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const missing = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        '',
      );
      expect(missing.statusCode).toBe(400);
      const wrong = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        pkce().verifier,
      );
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error).toBe('invalid_grant');
      // The challenge itself is no verifier.
      const challengeAsVerifier = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        challenge,
      );
      expect(challengeAsVerifier.json().error).toBe('invalid_grant');
      expect(
        (
          await exchange(
            client_id,
            await approvedCode(admin.cookie, client_id, challenge),
            verifier,
          )
        ).statusCode,
      ).toBe(200);
    });

    it('a code works once; its second use revokes what the first one gave', async () => {
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const code = await approvedCode(admin.cookie, client_id, challenge);
      const first = await exchange(client_id, code, verifier);
      expect(first.statusCode).toBe(200);
      const { access_token, refresh_token } = first.json<Tokens>();
      expect(await mcpStatus(access_token)).toBe(200);
      const again = await exchange(client_id, code, verifier);
      expect(again.statusCode).toBe(400);
      expect(again.json().error).toBe('invalid_grant');
      expect(await mcpStatus(access_token)).toBe(401);
      expect((await refresh(client_id, refresh_token)).statusCode).toBe(400);
    });

    it('a failed exchange still uses up the code', async () => {
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const code = await approvedCode(admin.cookie, client_id, challenge);
      expect((await exchange(client_id, code, pkce().verifier)).statusCode).toBe(400);
      expect((await exchange(client_id, code, verifier)).statusCode).toBe(400);
    });

    it('refuses another redirect address, another client and another resource', async () => {
      const { client_id } = await newClient({
        redirect_uris: [CALLBACK, 'http://localhost:9999/cb'],
      });
      const { client_id: otherClient } = await newClient();
      const { verifier, challenge } = pkce();
      const res1 = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
        {
          redirect_uri: 'http://localhost:9999/cb',
        },
      );
      expect(res1.json().error).toBe('invalid_grant');
      const res2 = await exchange(
        otherClient,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
      );
      expect(res2.json().error).toBe('invalid_grant');
      const res3 = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
        {
          resource: 'https://evil.example/mcp',
        },
      );
      expect(res3.json().error).toBe('invalid_target');
      const res4 = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
        {
          redirect_uri: '',
        },
      );
      expect(res4.statusCode).toBe(400);
    });

    it('refuses an expired code', async () => {
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const code = await approvedCode(admin.cookie, client_id, challenge);
      await test.deps.db
        .update(mcpOAuthCodes)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(mcpOAuthCodes.clientId, client_id));
      expect((await exchange(client_id, code, verifier)).json().error).toBe('invalid_grant');
    });

    it('a client with a secret must send it', async () => {
      const { client_id, client_secret } = await newClient({
        token_endpoint_auth_method: 'client_secret_post',
      });
      const { verifier, challenge } = pkce();
      const bad = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
        {
          client_secret: 'wrong',
        },
      );
      expect(bad.statusCode).toBe(401);
      expect(bad.json().error).toBe('invalid_client');
      const none = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
      );
      expect(none.statusCode).toBe(401);
      const good = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
        {
          client_secret: client_secret!,
        },
      );
      expect(good.statusCode, good.body).toBe(200);
      const basic = await exchange(
        client_id,
        await approvedCode(admin.cookie, client_id, challenge),
        verifier,
      );
      expect(basic.statusCode).toBe(401);
      const viaBasic = await tokenRequest(
        {
          grant_type: 'authorization_code',
          code: await approvedCode(admin.cookie, client_id, challenge),
          code_verifier: verifier,
          redirect_uri: CALLBACK,
        },
        {
          authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString('base64')}`,
        },
      );
      expect(viaBasic.statusCode, viaBasic.body).toBe(200);
    });

    it('refuses an unknown grant type and an unknown client', async () => {
      expect((await tokenRequest({ grant_type: 'password' })).json().error).toBe(
        'unsupported_grant_type',
      );
      const res = await tokenRequest({
        grant_type: 'authorization_code',
        client_id: 'nope',
        code: 'x',
        code_verifier: 'y',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('invalid_client');
    });
  });

  describe('refresh', () => {
    it('rotates: new tokens, the old access token stops, a reused refresh token revokes the connection', async () => {
      const first = await connect(admin.cookie);
      const second = await refresh(first.clientId, first.refresh_token);
      expect(second.statusCode, second.body).toBe(200);
      const next = second.json<Tokens>();
      expect(next.refresh_token).not.toBe(first.refresh_token);
      expect(next.access_token).not.toBe(first.access_token);
      expect(await mcpStatus(first.access_token)).toBe(401);
      expect(await mcpStatus(next.access_token)).toBe(200);

      // The old refresh token again: someone has a copy. Everything of this connection goes.
      const reuse = await refresh(first.clientId, first.refresh_token);
      expect(reuse.statusCode).toBe(400);
      expect(reuse.json().error).toBe('invalid_grant');
      expect(await mcpStatus(next.access_token)).toBe(401);
      expect((await refresh(first.clientId, next.refresh_token)).statusCode).toBe(400);
    });

    it('only for the client the refresh token was issued to', async () => {
      const first = await connect(admin.cookie);
      const { client_id: otherClient } = await newClient();
      expect((await refresh(otherClient, first.refresh_token)).json().error).toBe('invalid_grant');
      // The rightful client still refreshes.
      expect((await refresh(first.clientId, first.refresh_token)).statusCode).toBe(200);
    });

    it('cannot widen a read-only connection', async () => {
      const first = await connect(admin.cookie, 'read');
      expect(first.scope).toBe('read');
      const res = await tokenRequest({
        grant_type: 'refresh_token',
        client_id: first.clientId,
        refresh_token: first.refresh_token,
        scope: 'read write',
      });
      expect(res.json().error).toBe('invalid_scope');
    });
  });

  describe('scope and users', () => {
    it('a read-only connection lists no write tool and cannot write', async () => {
      const { access_token } = await connect(admin.cookie, 'read');
      const list = await mcpRequest(test.app, access_token, 'tools/list');
      const names = list.json().result.tools.map((t: { name: string }) => t.name);
      expect(names).toContain('whoami');
      expect(names).not.toContain('create_task');
      const res = await mcpRequest(test.app, access_token, 'tools/call', {
        name: 'create_task',
        arguments: { groupId: randomUUID(), task: { title: 'x' } },
      });
      expect(res.json().result.isError).toBe(true);
      expect(res.body).toContain('read-only token');
    });

    it('a deactivated admin: the code, the refresh and the access token are all refused', async () => {
      const ada = await newAdmin();
      const { client_id } = await newClient();
      const { verifier, challenge } = pkce();
      const pending = await approvedCode(ada.cookie, client_id, challenge);
      const live = await connect(ada.cookie);
      await deactivateUser(test.deps.db, ada.id);
      expect((await exchange(client_id, pending, verifier)).json().error).toBe('invalid_grant');
      expect(await mcpStatus(live.access_token)).toBe(401);
      expect((await refresh(live.clientId, live.refresh_token)).json().error).toBe('invalid_grant');
    });

    it('expired access tokens are refused', async () => {
      const { access_token } = await connect(admin.cookie);
      await test.deps.db
        .update(mcpTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(mcpTokens.userId, admin.id));
      expect(await mcpStatus(access_token)).toBe(401);
    });
  });

  describe('connections on the settings card', () => {
    const list = (cookie: string) =>
      test.app.inject({ method: 'GET', url: '/api/me/mcp/connections', headers: { cookie } });

    it('lists the user’s own connections, apart from personal tokens, and revokes them', async () => {
      const { access_token, refresh_token, clientId } = await connect(other.cookie, 'read');
      const res = await list(other.cookie);
      expect(res.statusCode).toBe(200);
      const items = res.json<McpConnection[]>();
      const mine = items.find((c) => c.clientName === 'Claude' && c.scope === 'read');
      expect(mine).toMatchObject({ redirectHost: 'claude.ai', scope: 'read' });
      expect(res.body).not.toContain(access_token);
      // Not a personal token.
      const tokens = await test.app.inject({
        method: 'GET',
        url: '/api/me/mcp/tokens',
        headers: { cookie: other.cookie },
      });
      expect(tokens.json<McpToken[]>()).toHaveLength(0);
      // Not someone else's to see or revoke.
      expect((await list(admin.cookie)).json<McpConnection[]>().map((c) => c.id)).not.toContain(
        mine!.id,
      );
      const foreign = await test.app.inject({
        method: 'DELETE',
        url: `/api/me/mcp/connections/${mine!.id}`,
        headers: { cookie: admin.cookie },
      });
      expect(foreign.statusCode).toBe(404);
      expect((await list(clientCookie)).statusCode).toBe(403);

      const revoke = await test.app.inject({
        method: 'DELETE',
        url: `/api/me/mcp/connections/${mine!.id}`,
        headers: { cookie: other.cookie },
      });
      expect(revoke.statusCode).toBe(204);
      expect(await mcpStatus(access_token)).toBe(401);
      expect((await refresh(clientId, refresh_token)).json().error).toBe('invalid_grant');
      expect((await list(other.cookie)).json<McpConnection[]>().map((c) => c.id)).not.toContain(
        mine!.id,
      );
    });

    it('stops at the most connections per user', async () => {
      const bea = await newAdmin();
      for (let i = 0; i < 10; i += 1) await connect(bea.cookie, 'read');
      const { client_id } = await newClient();
      const query = params(client_id, pkce().challenge);
      const info = (await consentInfo(bea.cookie, query)).json<McpConsentInfo>();
      if (info.kind !== 'consent') throw new Error('no consent');
      expect(info.limitReached).toBe(true);
      const res = await decide(bea.cookie, query, info.consentToken, true, 'read');
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('mcp_connection_limit');
    });
  });

  describe('revocation endpoint (RFC 7009)', () => {
    it('revoking the refresh token or the access token ends the connection', async () => {
      for (const which of ['refresh_token', 'access_token'] as const) {
        const tokens = await connect(admin.cookie);
        const res = await test.app.inject({
          method: 'POST',
          url: '/oauth/revoke',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload: new URLSearchParams({
            token: tokens[which],
            client_id: tokens.clientId,
          }).toString(),
        });
        expect(res.statusCode).toBe(200);
        expect(await mcpStatus(tokens.access_token)).toBe(401);
      }
    });

    it('answers 200 for an unknown token, and another client cannot revoke', async () => {
      const tokens = await connect(admin.cookie);
      const { client_id } = await newClient();
      const res = await test.app.inject({
        method: 'POST',
        url: '/oauth/revoke',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ token: tokens.refresh_token, client_id }).toString(),
      });
      expect(res.statusCode).toBe(200);
      expect(await mcpStatus(tokens.access_token)).toBe(200);
    });
  });
});
