import type { FastifyPluginAsync } from 'fastify';
import {
  EndpointBodySchema,
  ErrorCodes,
  ID_RE,
  ModeBodySchema,
  NotificationPrefsPatchSchema,
  PushSubscriptionBodySchema,
  type NotificationFallback,
  type NotificationPrefs,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { canReadGroup } from '../groups/policy.js';
import { getGroup } from '../groups/service.js';
import { isAdmin } from '../users/policy.js';
import {
  applyEmailFallback,
  getNotificationChannels,
  setNotificationChannel,
} from '../users/service.js';
import { visibleCategoriesFor } from './categories.js';
import { getModeSettings, setDefaultMode, setGroupMode } from './modes.js';
import { deleteOwnSubscription, saveSubscription } from './push-subscriptions.js';
import { clientGroupIds } from '../groups/memberships.js';

const USER_AGENT_MAX = 300;

/** Settings of the signed-in user only: every handler acts on `request.user`. */
export const notificationsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const anyUser = requireUser(app.auth);

  const prefsOf = async (actor: SessionUser): Promise<NotificationPrefs> => ({
    channels: await getNotificationChannels(db, actor.id),
    visibleCategories: await visibleCategoriesFor(db, actor),
    vapidPublicKey: config.push?.publicKey ?? null,
  });

  app.get('/notifications/preferences', { preHandler: anyUser }, async (request) =>
    prefsOf(request.user!),
  );

  app.patch('/notifications/preferences', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const parsed = NotificationPrefsPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    const { category, channel } = parsed.data;
    // A group the profile does not show is not the user's to set.
    if (!(await visibleCategoriesFor(db, actor)).includes(category)) {
      return reply.code(400).send({ error: ErrorCodes.validationFailed });
    }
    await setNotificationChannel(db, actor.id, category, channel);
    return prefsOf(actor);
  });

  // iOS without web push: once per user, the visible push groups get email too.
  // `email_fallback_at` keeps a later manual change.
  app.post(
    '/me/notification-fallback',
    { preHandler: anyUser },
    async (request): Promise<NotificationFallback> => {
      const actor = request.user!;
      const turnedOn = await applyEmailFallback(
        db,
        actor.id,
        await visibleCategoriesFor(db, actor),
      );
      return { ...(await prefsOf(actor)), turnedOn };
    },
  );

  app.get('/notifications/modes', { preHandler: anyUser }, async (request) =>
    getModeSettings(db, request.user!),
  );

  app.put('/notifications/modes/default', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!isAdmin(actor)) return reply.code(403).send({ error: ErrorCodes.forbidden });
    const parsed = ModeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    await setDefaultMode(db, actor.id, parsed.data.mode);
    return getModeSettings(db, actor);
  });

  app.put<{ Params: { groupId: string } }>(
    '/groups/:groupId/notification-mode',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      const { groupId } = request.params;
      // A malformed id cannot exist; checking first keeps NUL and the like away from Postgres.
      const readable =
        ID_RE.test(groupId) &&
        canReadGroup(actor, groupId, await clientGroupIds(db, actor.id)) &&
        (await getGroup(db, groupId)) !== null;
      if (!readable) return reply.code(404).send({ error: ErrorCodes.notFound });
      const parsed = ModeBodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      await setGroupMode(db, actor.id, groupId, parsed.data.mode);
      return reply.code(204).send();
    },
  );

  app.post('/push/subscriptions', { preHandler: anyUser }, async (request, reply) => {
    if (!deps.push) return reply.code(503).send({ error: ErrorCodes.pushUnavailable });
    const parsed = PushSubscriptionBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.invalidSubscription });
    const userAgent = request.headers['user-agent'];
    await saveSubscription(db, request.user!.id, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
    });
    return reply.code(204).send();
  });

  app.delete('/push/subscriptions', { preHandler: anyUser }, async (request, reply) => {
    const parsed = EndpointBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    await deleteOwnSubscription(db, request.user!.id, parsed.data.endpoint);
    return reply.code(204).send();
  });
};
