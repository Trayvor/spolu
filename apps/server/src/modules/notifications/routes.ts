import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  EndpointBodySchema,
  ErrorCodes,
  ID_RE,
  ModeBodySchema,
  NotificationGroupsQuerySchema,
  NotificationListQuerySchema,
  NotificationPrefsPatchSchema,
  PushSubscriptionBodySchema,
  SnoozeBodySchema,
  type NotificationFallback,
  NotificationEvents,
  type NotificationGroupsPage,
  type NotificationReadEvent,
  type NotificationPrefs,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { requireUser } from '../auth/session.js';
import { managedGroupIds } from '../groups/managers.js';
import { canReadGroup } from '../groups/policy.js';
import {
  getGroup,
  getGroupLabels,
  InvalidGroupCursorError,
  listGroupsPage,
} from '../groups/service.js';
import { watchStatesFor } from '../tickets/watch.js';
import {
  getCentreState,
  InvalidCentreCursorError,
  listCentre,
  markCentreItemRead,
  markCentreRead,
  setSnooze,
} from './centre.js';
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
/** Clients per page of the settings' client table (after the managed ones). */
const SETTINGS_PAGE = 50;

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

  // ---- The notification centre (UX review F2) and the push snooze ------------------------------
  app.get('/me/notifications', { preHandler: anyUser }, async (request, reply) => {
    const query = NotificationListQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      return await listCentre(db, request.user!, query.data);
    } catch (error) {
      if (error instanceof InvalidCentreCursorError) {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      throw error;
    }
  });

  app.get('/me/notifications/state', { preHandler: anyUser }, async (request) =>
    getCentreState(db, request.user!.id),
  );

  /** After the write: the person's other tabs and devices refetch the bell. */
  const emitRead = (userId: string, event: NotificationReadEvent) =>
    app.io.to(userRoom(userId)).emit(NotificationEvents.read, event);

  app.post('/me/notifications/read', { preHandler: anyUser }, async (request, reply) => {
    await markCentreRead(db, request.user!.id);
    emitRead(request.user!.id, { id: null });
    return reply.code(204).send();
  });

  // 2026-10-19: one item opened, from the centre's list or a push click (the service worker).
  app.post<{ Params: { id: string } }>(
    '/me/notifications/:id/read',
    { preHandler: anyUser },
    async (request, reply) => {
      const { id } = request.params;
      if (!ID_RE.test(id)) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      if (!(await markCentreItemRead(db, request.user!.id, id))) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      emitRead(request.user!.id, { id });
      return reply.code(204).send();
    },
  );

  app.put('/me/notifications/snooze', { preHandler: anyUser }, async (request, reply) => {
    const parsed = SnoozeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    return setSnooze(db, request.user!.id, parsed.data.for);
  });

  // ---- The client table of /settings/notifications (UX review X7) -------------------------------
  app.get(
    '/me/notification-groups',
    { preHandler: anyUser },
    async (request, reply): Promise<NotificationGroupsPage | FastifyReply> => {
      const actor = request.user!;
      const query = NotificationGroupsQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      const { q, cursor } = query.data;
      const matches = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase());
      const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
        a.name.localeCompare(b.name, 'sk') || a.id.localeCompare(b.id);
      if (!isAdmin(actor)) {
        // A client's own groups: a handful, one list. The admin group is never theirs.
        const ids = await clientGroupIds(db, actor.id);
        const labels = await getGroupLabels(db, ids);
        const rows = ids
          .map((id) => ({ id, name: labels.get(id)?.name ?? '', kind: 'client' as const }))
          .filter((g) => matches(g.name))
          .sort(byName);
        const watch = await watchStatesFor(db, actor, rows, new Set());
        return {
          managed: [],
          items: rows.map((g) => ({ ...g, managed: false, watching: watch.get(g.id) ?? null })),
          nextCursor: null,
        };
      }
      let groupPage;
      try {
        groupPage = await listGroupsPage(db, actor.id, { q, limit: SETTINGS_PAGE, cursor });
      } catch (error) {
        if (error instanceof InvalidGroupCursorError) {
          return reply.code(400).send({ error: ErrorCodes.validationFailed });
        }
        throw error;
      }
      // The managed clients come first, on the first page only (an admin manages a few dozen).
      const managedIds = await managedGroupIds(db, actor.id);
      const managedSet = new Set(managedIds);
      const managedRows =
        cursor === undefined
          ? [...(await getGroupLabels(db, managedIds))]
              .map(([id, label]) => ({ id, name: label.name, kind: 'client' as const }))
              .filter((g) => matches(g.name))
              .sort(byName)
          : [];
      const others = groupPage.items
        .filter((g) => !managedSet.has(g.id))
        .map((g) => ({ id: g.id, name: g.name, kind: g.kind }));
      const watch = await watchStatesFor(db, actor, [...managedRows, ...others], managedSet);
      const row = (
        g: { id: string; name: string; kind: 'client' | 'admin' },
        managed: boolean,
      ) => ({
        ...g,
        managed,
        watching: watch.get(g.id) ?? null,
      });
      return {
        managed: managedRows.map((g) => row(g, true)),
        items: others.map((g) => row(g, false)),
        nextCursor: groupPage.nextCursor,
      };
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
