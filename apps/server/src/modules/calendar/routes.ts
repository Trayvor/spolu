import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import {
  CALENDAR_FEED_LIMITS,
  CalendarFeedPutBodySchema,
  ErrorCodes,
  type CalendarFeedAnswer,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { clientGroupIds } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { getUserById } from '../users/service.js';
import { feedCreatedEmail } from './emails.js';
import { canUseCalendarFeed } from './policy.js';
import { deleteFeedOf, getFeed, putFeed, rotateFeed, toFeedDto, type FeedRow } from './service.js';

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * The signed-in person's own calendar feed (ADR 0051): read, create or change its switches,
 * rotate its link, revoke it. Every route acts on `request.user` only; none is in the MCP
 * allowlist, so an AI assistant can neither read nor reveal the feed URL.
 */
export const calendarFeedRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const allowWrite = createRateLimiter({
    windowMs: 3_600_000,
    max: CALENDAR_FEED_LIMITS.writesPerHour,
  });
  const feedUser: preHandlerAsyncHookHandler[] = [
    requireUser(app.auth),
    async (request, reply) => {
      const actor = request.user!;
      const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
      if (!canUseCalendarFeed(actor, groupIds)) return send(reply, 403, ErrorCodes.forbidden);
    },
  ];
  const answer = (row: FeedRow | null): CalendarFeedAnswer => ({
    feed: row ? toFeedDto(row, config.publicUrl, config.appSecret) : null,
  });

  /** Tells the owner a link was made; a failure is logged, never answered. */
  async function notify(userId: string, log: { error(obj: object, msg: string): void }) {
    try {
      const owner = await getUserById(db, userId);
      if (owner) {
        await sendEmailLater(
          deps.jobs,
          feedCreatedEmail({ to: owner.email, lang: owner.language, publicUrl: config.publicUrl }),
        );
      }
    } catch (error) {
      log.error({ err: error }, 'could not queue the calendar feed notice');
    }
  }

  app.get('/me/calendar-feed', { preHandler: feedUser }, async (request) =>
    answer(await getFeed(db, request.user!.id)),
  );

  app.put('/me/calendar-feed', { preHandler: feedUser }, async (request, reply) => {
    const body = CalendarFeedPutBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const { row, created } = await putFeed(
      db,
      config.appSecret,
      request.user!.id,
      body.data.include,
    );
    if (created) await notify(row.userId, request.log);
    return reply.code(created ? 201 : 200).send(answer(row));
  });

  app.post('/me/calendar-feed/rotate', { preHandler: feedUser }, async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const row = await rotateFeed(db, config.appSecret, request.user!.id);
    if (!row) return send(reply, 404, ErrorCodes.notFound);
    await notify(row.userId, request.log);
    return answer(row);
  });

  app.delete('/me/calendar-feed', { preHandler: feedUser }, async (request, reply) => {
    if (!(await deleteFeedOf(db, request.user!.id))) return send(reply, 404, ErrorCodes.notFound);
    return reply.code(204).send();
  });
};
