import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import {
  ErrorCodes,
  MCP_OAUTH_LIMITS,
  McpAuthorizeParamsSchema,
  McpConsentDecisionSchema,
  type McpConsentInfo,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { getSessionFromHeaders, requireAdmin } from '../auth/session.js';
import { getUserById } from '../users/service.js';
import { connectionApprovedEmail } from './emails.js';
import {
  approve,
  authenticateClient,
  checkAuthorizeRequest,
  ConnectionLimitError,
  countActiveConnections,
  deny,
  exchangeCode,
  listConnections,
  makeConsentToken,
  OAuthError,
  oauthUrls,
  refreshTokens,
  registerClient,
  revokeByToken,
  revokeConnection,
  verifyConsentToken,
} from './oauth.js';
import { canUseMcp } from './policy.js';
import { auditActorOf } from '../audit/request-actor.js';

/**
 * The OAuth endpoints of the MCP server (ADR 0034): the metadata at `/.well-known/*`, dynamic
 * client registration, the token endpoint and revocation. Public (a client has no session), outside
 * `/api`, so neither the session nor the CSRF guard is involved; each is rate limited per address.
 * The consent screen's API is `mcpConsentRoutes` below, under `/api` and a session.
 */
export const mcpOAuthRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const { issuer, resource } = oauthUrls(config.publicUrl);
  const allowRegister = createRateLimiter({ windowMs: 3_600_000, max: 30 });
  const allowFailure = createRateLimiter({ windowMs: 60_000, max: 60 });

  // RFC 6749 §4.1.3: token and revocation requests are form-encoded (JSON is accepted too).
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16_384 },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );

  const sendError = (reply: FastifyReply, error: unknown) => {
    if (!(error instanceof OAuthError)) throw error;
    if (error.status === 401) reply.header('www-authenticate', 'Basic realm="spolu"');
    return reply
      .code(error.status)
      .header('cache-control', 'no-store')
      .send({
        error: error.error,
        ...(error.description ? { error_description: error.description } : {}),
      });
  };

  const protectedResource = {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['read', 'write'],
    bearer_methods_supported: ['header'],
    resource_name: 'Help by eGrant',
    resource_documentation: 'https://help.egrant.sk',
  };
  // RFC 9728 §3.1: the path-suffixed address first, the root one for older clients.
  app.get('/.well-known/oauth-protected-resource', async () => protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', async () => protectedResource);

  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: [
      'none',
      'client_secret_post',
      'client_secret_basic',
    ],
    scopes_supported: ['read', 'write'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://help.egrant.sk',
  }));

  app.post('/oauth/register', { bodyLimit: 16_384 }, async (request, reply) => {
    if (!allowRegister(request.ip)) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }
    try {
      const client = await registerClient(db, request.body);
      return reply.code(201).header('cache-control', 'no-store').send(client);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  const asBody = (body: unknown): Record<string, unknown> =>
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  app.post('/oauth/token', { bodyLimit: 16_384 }, async (request, reply) => {
    const body = asBody(request.body);
    try {
      const grantType = body.grant_type;
      if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
        throw new OAuthError(400, 'unsupported_grant_type');
      }
      const client = await authenticateClient(db, body, request.headers.authorization);
      const tokens =
        grantType === 'authorization_code'
          ? await exchangeCode(db, config.publicUrl, client, body)
          : await refreshTokens(db, client, body);
      return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(tokens);
    } catch (error) {
      if (!allowFailure(request.ip)) return reply.code(429).send({ error: 'too_many_requests' });
      return sendError(reply, error);
    }
  });

  app.post('/oauth/revoke', { bodyLimit: 16_384 }, async (request, reply) => {
    const body = asBody(request.body);
    try {
      const client = await authenticateClient(db, body, request.headers.authorization);
      if (typeof body.token === 'string') await revokeByToken(db, client, body.token);
      return reply.code(200).send();
    } catch (error) {
      if (!allowFailure(request.ip)) return reply.code(429).send({ error: 'too_many_requests' });
      return sendError(reply, error);
    }
  });
};

type IdParams = { Params: { id: string } };

/**
 * The consent screen's API (`/oauth/authorize` in the web app) and the connections on the
 * settings card, under `/api`: a session, admins only (`canUseMcp`), and the `/api` CSRF guard.
 * None of them is in the MCP allowlist.
 */
export const mcpConsentRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const mcpUser: preHandlerAsyncHookHandler[] = [
    requireAdmin(app.auth),
    async (request, reply) => {
      if (!canUseMcp(request.user!)) return reply.code(403).send({ error: ErrorCodes.forbidden });
    },
  ];
  const sessionId = async (headers: Parameters<typeof getSessionFromHeaders>[1]) =>
    (await getSessionFromHeaders(app.auth, headers))?.sessionId ?? null;

  app.get('/oauth/authorize', { preHandler: mcpUser }, async (request, reply) => {
    const params = McpAuthorizeParamsSchema.safeParse(request.query);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    const check = await checkAuthorizeRequest(db, config.publicUrl, params.data);
    if (check.kind === 'refuse') return reply.code(400).send({ error: check.error });
    if (check.kind === 'redirect') {
      return { kind: 'redirect', redirectTo: check.redirectTo } satisfies McpConsentInfo;
    }
    const session = await sessionId(request.headers);
    if (!session) return reply.code(401).send({ error: ErrorCodes.unauthorized });
    return {
      kind: 'consent',
      clientName: check.client.name,
      redirectHost: new URL(check.redirectUri).hostname,
      requestedScope: check.maxScope,
      consentToken: makeConsentToken(config.appSecret, session, params.data),
      limitReached:
        (await countActiveConnections(db, request.user!.id)) >= MCP_OAUTH_LIMITS.activeConnections,
    } satisfies McpConsentInfo;
  });

  app.post('/oauth/authorize', { preHandler: mcpUser }, async (request, reply) => {
    const body = McpConsentDecisionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    const { params, consentToken, scope } = body.data;
    const session = await sessionId(request.headers);
    if (!session || !verifyConsentToken(config.appSecret, session, params, consentToken)) {
      return reply.code(403).send({ error: ErrorCodes.forbidden });
    }
    const check = await checkAuthorizeRequest(db, config.publicUrl, params);
    if (check.kind === 'refuse') return reply.code(400).send({ error: check.error });
    if (check.kind === 'redirect') return { redirectTo: check.redirectTo };
    if (!body.data.approve) return { redirectTo: deny(config.publicUrl, check) };
    try {
      const target = await approve(db, config.publicUrl, request.user!, check, scope);
      request.log.info(
        { userId: request.user!.id, oauthClient: check.client.id, scope },
        'mcp oauth approved',
      );
      // Tell the owner, as for a new token: a connection made with a stolen session is noticed.
      try {
        const owner = await getUserById(db, request.user!.id);
        if (owner) {
          await sendEmailLater(
            deps.jobs,
            connectionApprovedEmail(
              { to: owner.email, lang: owner.language, publicUrl: config.publicUrl },
              {
                name: check.client.name,
                host: new URL(check.redirectUri).hostname,
                approvedAt: new Date(),
              },
            ),
          );
        }
      } catch (error) {
        request.log.error({ err: error }, 'could not queue the MCP connection notice');
      }
      return { redirectTo: target };
    } catch (error) {
      if (error instanceof ConnectionLimitError) {
        return reply.code(409).send({ error: ErrorCodes.mcpConnectionLimit });
      }
      if (error instanceof OAuthError) return reply.code(400).send({ error: error.error });
      throw error;
    }
  });

  app.get('/me/mcp/connections', { preHandler: mcpUser }, async (request) =>
    listConnections(db, request.user!.id),
  );

  app.delete<IdParams>(
    '/me/mcp/connections/:id',
    { preHandler: mcpUser },
    async (request, reply) => {
      const revoked = await revokeConnection(
        db,
        request.user!.id,
        request.params.id,
        auditActorOf(request),
      );
      if (!revoked) return reply.code(404).send({ error: ErrorCodes.notFound });
      return reply.code(204).send();
    },
  );
};
