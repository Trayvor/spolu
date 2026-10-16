import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  BulkSubscriptionSchema,
  ErrorCodes,
  type BulkSubscription,
  type BulkUnsubscribeInfo,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { getUserById, type UserRow } from '../users/service.js';
import { queueProviderResubscribe } from './jobs.js';
import { isSubscribed, setSubscribed } from './subscriptions.js';
import { TEST_CAMPAIGN_ID, verifyUnsubscribeToken } from './token.js';

type TokenParams = { Params: { token: string } };

/** The unsubscribe links of the emails are this many calls a minute per IP (all four routes). */
const PUBLIC_PER_MINUTE = 30;

/**
 * Unsubscribe and re-subscribe (spec §5, P3, P4): the four public token routes and the
 * signed-in person's "Receive mailings" setting. The token is the credential: no session, and
 * the app's CSRF guard skips these POSTs (mail providers send the RFC 8058 one-click from their
 * servers). Every answer for a bad signature or a deleted person is `404`; the GET tells only the
 * language and the setting, never who the token belongs to.
 */
export const bulkEmailUnsubscribeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { config, db } = deps;

  // A re-subscribe in `elastic` mode also asks Elastic to drop its suppression. Queueing can
  // fail only when the queue is down; the change is already saved, so it is logged, not answered.
  async function afterSubscribe(request: FastifyRequest, email: string): Promise<void> {
    try {
      await queueProviderResubscribe(deps, email);
    } catch (error) {
      request.log.warn({ err: error }, 'bulk email: Elastic resubscribe not queued');
    }
  }

  await app.register(async (pub) => {
    const allow = createRateLimiter({ windowMs: 60_000, max: PUBLIC_PER_MINUTE });
    // The one-click POST carries `List-Unsubscribe=One-Click` as a form (some providers send
    // multipart): accept any body and ignore it. Scoped to these routes.
    pub.removeAllContentTypeParsers();
    pub.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 4096 }, (_req, _body, done) =>
      done(null, undefined),
    );

    /** The person and campaign of a valid token, or a sent 404 / 429 (then null). */
    async function resolve(
      request: FastifyRequest<TokenParams>,
      reply: FastifyReply,
    ): Promise<{ person: UserRow; campaignId: string } | null> {
      if (!allow(request.ip)) {
        await reply.code(429).send({ error: ErrorCodes.rateLimited });
        return null;
      }
      const parsed = verifyUnsubscribeToken(config.appSecret, request.params.token);
      const person = parsed ? await getUserById(db, parsed.userId) : null;
      if (!parsed || !person) {
        await reply.code(404).send({ error: ErrorCodes.notFound });
        return null;
      }
      return { person, campaignId: parsed.campaignId };
    }

    pub.get<TokenParams>('/bulk-email/unsubscribe/:token', async (request, reply) => {
      const found = await resolve(request, reply);
      if (!found) return reply;
      const info: BulkUnsubscribeInfo = {
        language: found.person.language,
        subscribed: await isSubscribed(db, found.person.id),
        test: found.campaignId === TEST_CAMPAIGN_ID,
      };
      return info;
    });

    const unsubscribe =
      (source: 'link' | 'one_click') =>
      async (request: FastifyRequest<TokenParams>, reply: FastifyReply) => {
        const found = await resolve(request, reply);
        if (!found) return reply;
        // A test email's link changes nothing (spec §3).
        if (found.campaignId !== TEST_CAMPAIGN_ID) {
          await setSubscribed(db, found.person.id, false, source, found.campaignId);
        }
        return reply.code(204).send();
      };
    pub.post<TokenParams>('/bulk-email/unsubscribe/:token', unsubscribe('link'));
    pub.post<TokenParams>('/bulk-email/unsubscribe/:token/one-click', unsubscribe('one_click'));

    pub.post<TokenParams>('/bulk-email/subscribe/:token', async (request, reply) => {
      const found = await resolve(request, reply);
      if (!found) return reply;
      if (found.campaignId !== TEST_CAMPAIGN_ID) {
        const result = await setSubscribed(db, found.person.id, true, 'link', null);
        if (result === 'changed') await afterSubscribe(request, found.person.email);
      }
      return reply.code(204).send();
    });
  });

  const signedIn = requireUser(app.auth);

  app.get('/me/bulk-email', { preHandler: signedIn }, async (request) => {
    const answer: BulkSubscription = { subscribed: await isSubscribed(db, request.user!.id) };
    return answer;
  });

  app.put('/me/bulk-email', { preHandler: signedIn }, async (request, reply) => {
    const body = BulkSubscriptionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    const me = request.user!;
    const result = await setSubscribed(db, me.id, body.data.subscribed, 'profile', null);
    if (result === 'changed' && body.data.subscribed) await afterSubscribe(request, me.email);
    return reply.code(204).send();
  });
};
