import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { AuthorRecipientError, NoReminderSetError, NotReadableError } from './errors.js';
import { buildIcs, getReminderSet, subscribe, unsubscribe } from './service.js';
import { listReminderSubjects, type ReminderSubject } from './subjects.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);

/** Maps the expected errors of a subscription change; anything else is rethrown (500). */
function subscriptionError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof NotReadableError) return notFound(reply);
  if (error instanceof NoReminderSetError) return send(reply, 404, ErrorCodes.noReminderSet);
  if (error instanceof AuthorRecipientError) return send(reply, 400, ErrorCodes.authorRecipient);
  throw error;
}

/**
 * The reminder endpoints of every registered subject, under `/api/<routePrefix>/:id/reminders`.
 * Register the subjects before this plugin. A subject the actor cannot read answers 404 on every
 * route, as a missing one.
 */
export const remindersRoutes: FastifyPluginAsync<{
  deps: AppDeps;
  /** The knowledge writes' limiter: subscription changes share its 120 per minute per user. */
  allowWrite: (userId: string) => boolean;
}> = async (app, { deps, allowWrite }) => {
  const { db, config } = deps;
  const anyUser = requireUser(app.auth);
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };
  const writeGuard = [anyUser, limitWrites];

  const register = (subject: ReminderSubject) => {
    const base = `/${subject.routePrefix}/:id/reminders`;
    const ref = (id: string) => ({ kind: subject.kind, id });

    app.get<IdParams>(base, { preHandler: anyUser }, async (request, reply) => {
      const set = await getReminderSet(db, ref(request.params.id), request.user!);
      return set ?? notFound(reply);
    });

    app.post<IdParams>(
      `${base}/subscription`,
      { preHandler: writeGuard },
      async (request, reply) => {
        try {
          await subscribe(db, ref(request.params.id), request.user!);
        } catch (error) {
          return subscriptionError(reply, error);
        }
        return reply.code(204).send();
      },
    );

    app.delete<IdParams>(
      `${base}/subscription`,
      { preHandler: writeGuard },
      async (request, reply) => {
        try {
          await unsubscribe(db, ref(request.params.id), request.user!);
        } catch (error) {
          return subscriptionError(reply, error);
        }
        return reply.code(204).send();
      },
    );

    // Unreadable, missing, or no upcoming time: 404.
    app.get<IdParams>(`${base}/calendar.ics`, { preHandler: anyUser }, async (request, reply) => {
      const ics = await buildIcs(db, ref(request.params.id), request.user!, config.publicUrl);
      if (!ics) return notFound(reply);
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('content-disposition', `attachment; filename="${ics.filename}"`)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(ics.text);
    });
  };

  for (const subject of listReminderSubjects()) register(subject);
};
