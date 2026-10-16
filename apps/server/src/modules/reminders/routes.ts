import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import type { ZodError } from 'zod';
import { ErrorCodes, ReminderPutSchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { getNotificationProfiles } from '../users/service.js';
import {
  AuthorRecipientError,
  InvalidRecipientError,
  InvalidReminderError,
  NoReminderSetError,
  NotReadableError,
  ReminderInPastError,
} from './errors.js';
import { notifyTimesChanged } from './realtime.js';
import {
  buildIcs,
  getReminderSetOrEmpty,
  saveReminderSet,
  subscribe,
  unsubscribe,
} from './service.js';
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

/** Maps the expected errors of a `PUT`; anything else is rethrown (500). */
function putError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof NotReadableError) return notFound(reply);
  if (error instanceof InvalidReminderError) return send(reply, 400, ErrorCodes.invalidReminder);
  if (error instanceof ReminderInPastError) return send(reply, 400, ErrorCodes.reminderInPast);
  if (error instanceof InvalidRecipientError) return send(reply, 400, ErrorCodes.invalidRecipient);
  throw error;
}

/** 400 for a `PUT` body that failed the schema: the times and the recipients have their codes. */
function putBodyCode(error: ZodError): string {
  const at = (key: string) => error.issues.some((issue) => issue.path[0] === key);
  if (at('recipientIds')) return ErrorCodes.invalidRecipient;
  if (at('times') || at('baseTimeIds')) return ErrorCodes.invalidReminder;
  return ErrorCodes.validationFailed;
}

/**
 * The reminder endpoints of every registered subject, under `/api/<routePrefix>/:id/reminders`.
 * Register the subjects before this plugin. A subject the actor cannot read answers 404 on every
 * route, as a missing one.
 */
export const remindersRoutes: FastifyPluginAsync<{
  deps: AppDeps;
  /**
   * The knowledge writes' limiter: subscription changes and `PUT`s share its 120 per minute per
   * user (the same limit as the tasks module's writes).
   */
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

    // A readable subject without reminders answers the empty set.
    app.get<IdParams>(base, { preHandler: anyUser }, async (request, reply) => {
      const set = await getReminderSetOrEmpty(db, ref(request.params.id), request.user!);
      return set ?? notFound(reply);
    });

    // Subjects whose times are not edited with their own form (tasks).
    if (subject.standaloneEdit) {
      app.put<IdParams>(base, { preHandler: writeGuard }, async (request, reply) => {
        const body = ReminderPutSchema.safeParse(request.body);
        if (!body.success) return send(reply, 400, putBodyCode(body.error));
        const target = ref(request.params.id);
        try {
          await saveReminderSet(db, target, body.data, request.user!);
        } catch (error) {
          return putError(reply, error);
        }
        await notifyTimesChanged(db, [target]);
        const set = await getReminderSetOrEmpty(db, target, request.user!);
        return set ?? notFound(reply);
      });
    }

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

    // Unreadable, missing, or no deadline and no upcoming time: 404.
    app.get<IdParams>(`${base}/calendar.ics`, { preHandler: anyUser }, async (request, reply) => {
      const actor = request.user!;
      const profile = (await getNotificationProfiles(db, [actor.id])).get(actor.id);
      const ics = await buildIcs(
        db,
        ref(request.params.id),
        actor,
        config.publicUrl,
        new Date(),
        profile?.language ?? 'en',
      );
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
