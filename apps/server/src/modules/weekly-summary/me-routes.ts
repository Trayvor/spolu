import type { FastifyPluginAsync } from 'fastify';
import {
  ErrorCodes,
  MyWeeklySummarySchema,
  WeeklySummaryReminderSchema,
  type MyWeeklySummaryGroups,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { clientGroupIds } from '../groups/memberships.js';
import { getGroupLabels } from '../groups/service.js';
import { canSetMyWeeklySummary } from './policy.js';
import {
  getRemind,
  groupSettings,
  setRemind,
  setSubscribed,
  unsubscribedGroups,
} from './service.js';

/**
 * A person's own weekly summary settings (spec §7, §8): a client's opt-out per group (the
 * profile's "Týždenný prehľad e-mailom"), an admin's "remind me" choice.
 */
export const weeklySummaryMeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { db } = deps;
  const signedIn = requireUser(app.auth);
  const adminOnly = requireAdmin(app.auth);

  // Before `/:groupId`.
  app.get('/me/weekly-summary/reminder', { preHandler: adminOnly }, async (request) => ({
    remind: await getRemind(db, request.user!.id),
  }));

  app.put('/me/weekly-summary/reminder', { preHandler: adminOnly }, async (request, reply) => {
    const body = WeeklySummaryReminderSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    await setRemind(db, request.user!.id, body.data.remind);
    return { remind: body.data.remind };
  });

  app.get('/me/weekly-summary', { preHandler: signedIn }, async (request) => {
    const me = request.user!;
    if (me.role !== 'client') return { groups: [] } satisfies MyWeeklySummaryGroups;
    const ids = await clientGroupIds(db, me.id);
    const [labels, off, settings] = await Promise.all([
      getGroupLabels(db, ids),
      unsubscribedGroups(db, me.id, ids),
      groupSettings(db, ids),
    ]);
    const answer: MyWeeklySummaryGroups = {
      groups: ids
        .flatMap((id) => {
          const label = labels.get(id);
          return label
            ? [
                {
                  groupId: id,
                  name: label.name,
                  subscribed: !off.has(id),
                  enabled: settings.get(id) ?? true,
                },
              ]
            : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    return answer;
  });

  app.put<{ Params: { groupId: string } }>(
    '/me/weekly-summary/:groupId',
    { preHandler: signedIn },
    async (request, reply) => {
      const me = request.user!;
      if (me.role !== 'client') return reply.code(403).send({ error: ErrorCodes.forbidden });
      const body = MyWeeklySummarySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      const ids = await clientGroupIds(db, me.id);
      if (!canSetMyWeeklySummary(me, request.params.groupId, ids)) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      await setSubscribed(db, me.id, request.params.groupId, body.data.subscribed);
      return { subscribed: body.data.subscribed };
    },
  );
};
