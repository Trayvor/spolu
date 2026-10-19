import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes, type WeeklySummaryUnsubscribeInfo } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { getGroup, type GroupRow } from '../groups/service.js';
import { getUserById, type UserRow } from '../users/service.js';
import { setSubscribed, unsubscribedGroups } from './service.js';
import { verifySummaryUnsubscribeToken } from './token.js';

type TokenParams = { Params: { token: string } };

/** Calls a minute per IP over the three routes. */
const PUBLIC_PER_MINUTE = 30;

/**
 * The weekly summary email's unsubscribe link (spec §8): the signed token is the credential, no
 * session; the app's CSRF guard skips these POSTs (mail providers send the RFC 8058 one-click
 * from their servers). They act only on the token's person and group and tell only the group's
 * name, the person's language and the setting; a bad token or a removed person is `404`.
 */
export const weeklySummaryUnsubscribeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { config, db } = deps;
  const allow = createRateLimiter({ windowMs: 60_000, max: PUBLIC_PER_MINUTE });
  // The one-click POST carries `List-Unsubscribe=One-Click` as a form: accept any body.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 4096 }, (_req, _body, done) =>
    done(null, undefined),
  );

  async function resolve(
    request: FastifyRequest<TokenParams>,
    reply: FastifyReply,
  ): Promise<{ person: UserRow; group: GroupRow } | null> {
    if (!allow(request.ip)) {
      await reply.code(429).send({ error: ErrorCodes.rateLimited });
      return null;
    }
    const parsed = verifySummaryUnsubscribeToken(config.appSecret, request.params.token);
    const [person, group] = parsed
      ? await Promise.all([getUserById(db, parsed.userId), getGroup(db, parsed.groupId)])
      : [null, null];
    if (!parsed || !person || !group) {
      await reply.code(404).send({ error: ErrorCodes.notFound });
      return null;
    }
    return { person, group };
  }

  const info = async (person: UserRow, group: GroupRow): Promise<WeeklySummaryUnsubscribeInfo> => ({
    groupName: group.name,
    language: person.language,
    subscribed: !(await unsubscribedGroups(db, person.id, [group.id])).has(group.id),
  });

  app.get<TokenParams>('/weekly-summary/unsubscribe/:token', async (request, reply) => {
    const found = await resolve(request, reply);
    if (!found) return reply;
    return info(found.person, found.group);
  });

  app.post<TokenParams>('/weekly-summary/unsubscribe/:token', async (request, reply) => {
    const found = await resolve(request, reply);
    if (!found) return reply;
    await setSubscribed(db, found.person.id, found.group.id, false);
    return info(found.person, found.group);
  });

  app.post<TokenParams>('/weekly-summary/unsubscribe/:token/one-click', async (request, reply) => {
    const found = await resolve(request, reply);
    if (!found) return reply;
    await setSubscribed(db, found.person.id, found.group.id, false);
    return reply.code(200).send();
  });

  app.post<TokenParams>('/weekly-summary/subscribe/:token', async (request, reply) => {
    const found = await resolve(request, reply);
    if (!found) return reply;
    await setSubscribed(db, found.person.id, found.group.id, true);
    return info(found.person, found.group);
  });
};
