import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  ErrorCodes,
  GroupInputSchema,
  type Group,
  type GroupManager,
  type GroupManagersResponse,
  type ManagersResponse,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Config } from '../../infra/config/config.js';
import { disconnectUser, joinGroupRoom, leaveGroupRoom } from '../../infra/realtime/rooms.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { revokeAllSessions } from '../auth/service.js';
import { getEffectiveGroupMode } from '../notifications/modes.js';
import { deactivateUser, getUserById, reactivateUser } from '../users/service.js';
import { emitManagers } from './events.js';
import { logoRoutes } from './logo.js';
import { addManager, GroupNotFoundError, NotAnAdminError, removeManager } from './managers.js';
import {
  canBeManager,
  canManageGroups,
  canReadGroup,
  canRemoveMember,
  canSetManager,
} from './policy.js';
import {
  createGroup,
  EgrantUrlTakenError,
  getGroup,
  InvalidEgrantUrlError,
  listGroupPeople,
  listGroups,
  listMembers,
  regenerateInvite,
  updateGroup,
  type GroupRow,
} from './service.js';
import {
  clientGroupIds,
  getMembership,
  removeMembership,
  restoreMembership,
} from './memberships.js';

type IdParams = { Params: { id: string } };
type MemberParams = { Params: { id: string; userId: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });

/** Calls a minute per admin to become or stop being a manager. */
export const managerRateLimit = (config: Config): number => config.managerRateLimitPerMinute ?? 120;

export const groupsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { config, db } = deps;
  await app.register(logoRoutes, { deps });
  const anyUser = requireUser(app.auth);

  const inviteUrl = (token: string): string => `${config.publicUrl}/join/${token}`;
  const toGroup = (row: GroupRow, withInvite: boolean): Group => ({
    id: row.id,
    name: row.name,
    egrantUrl: row.egrantUrl,
    hasLogo: row.logoKey !== null,
    updatedAt: row.updatedAt.toISOString(),
    ...(withInvite ? { inviteUrl: inviteUrl(row.inviteToken) } : {}),
  });

  /** Maps the service errors of create/update to API errors; rethrows anything else. */
  const groupWriteError = (error: unknown, reply: FastifyReply): FastifyReply => {
    if (error instanceof EgrantUrlTakenError) {
      return reply.code(409).send({ error: ErrorCodes.egrantUrlTaken });
    }
    if (error instanceof InvalidEgrantUrlError) {
      return reply.code(400).send({ error: ErrorCodes.validationFailed });
    }
    throw error;
  };

  app.get('/groups', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    return listGroups(db, request.user!.id);
  });

  app.post('/groups', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    const body = GroupInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      return reply.code(201).send(toGroup(await createGroup(db, body.data), true));
    } catch (error) {
      return groupWriteError(error, reply);
    }
  });

  app.get<IdParams>('/groups/:id', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    const group = await getGroup(db, id);
    if (!group) return notFound(reply);
    return toGroup(group, canManageGroups(actor));
  });

  app.patch<IdParams>('/groups/:id', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    const body = GroupInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      const group = await updateGroup(db, request.params.id, body.data);
      return group ? toGroup(group, true) : notFound(reply);
    } catch (error) {
      return groupWriteError(error, reply);
    }
  });

  app.post<IdParams>('/groups/:id/invite', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    // Check first: regenerateInvite throws a plain Error for an unknown id.
    if (!(await getGroup(db, request.params.id))) return notFound(reply);
    return { inviteUrl: inviteUrl(await regenerateInvite(db, request.params.id)) };
  });

  app.get<IdParams>('/groups/:id/members', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    if (!(await getGroup(db, id))) return notFound(reply);
    return listMembers(db, id, { removed: false });
  });

  app.get<IdParams>('/groups/:id/people', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    if (!(await getGroup(db, id))) return notFound(reply);
    return listGroupPeople(db, id);
  });

  // Requesters (Phase 21): the group's ziadatel members, for the Members tab's own section.
  app.get<IdParams>('/groups/:id/requesters', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    if (!(await getGroup(db, id))) return notFound(reply);
    return listMembers(db, id, { removed: false, role: 'ziadatel' });
  });

  app.get<IdParams>(
    '/groups/:id/requesters/removed',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      if (!(await getGroup(db, request.params.id))) return notFound(reply);
      return listMembers(db, request.params.id, { removed: true, role: 'ziadatel' });
    },
  );

  app.get<IdParams>(
    '/groups/:id/members/removed',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      if (!(await getGroup(db, request.params.id))) return notFound(reply);
      return listMembers(db, request.params.id, { removed: true });
    },
  );

  /** The target of remove/restore: a user with a membership of this group, else null (404). */
  const groupMember = async (groupId: string, userId: string) => {
    const target = await getUserById(db, userId);
    if (!target || !(await getMembership(db, userId, groupId))) return null;
    return target;
  };

  app.delete<MemberParams>(
    '/groups/:id/members/:userId',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      const target = await groupMember(request.params.id, request.params.userId);
      if (!target) return notFound(reply);
      if (!canRemoveMember(request.user!, target)) return forbidden(reply);
      // Removed from this group only; with no active membership left they are signed out.
      const { lastActive } = await removeMembership(db, request.params.id, target.id);
      if (lastActive) {
        await deactivateUser(db, target.id);
        await revokeAllSessions(db, target.id);
        disconnectUser(app.io, target.id);
      } else {
        leaveGroupRoom(app.io, target.id, request.params.id);
      }
      return reply.code(204).send();
    },
  );

  app.post<MemberParams>(
    '/groups/:id/members/:userId/restore',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      const target = await groupMember(request.params.id, request.params.userId);
      if (!target) return notFound(reply);
      if (!canRemoveMember(request.user!, target)) return forbidden(reply);
      await restoreMembership(db, request.params.id, target.id);
      await reactivateUser(db, target.id);
      // A requester's membership never opens the group, so their sockets stay out of its room.
      const membership = await getMembership(db, target.id, request.params.id);
      if (membership?.role === 'client') joinGroupRoom(app.io, target.id, request.params.id);
      return reply.code(204).send();
    },
  );

  // Managers: an admin adds or removes themselves (`/managers/me`, answering their own mode too),
  // or any active admin (`/managers/:userId`, from the group's Members tab). One rate limit for both.
  const allowManagerChange = createRateLimiter({ windowMs: 60_000, max: managerRateLimit(config) });
  const adminOnly = requireAdmin(app.auth);

  /**
   * Runs the change for `targetId` and sends `answer(managers)`. The answer is built before the
   * event goes out, so a failure there never follows an event already sent.
   */
  const applyManagerChange = async <T>(
    actorId: string,
    change: typeof addManager,
    groupId: string,
    targetId: string,
    reply: FastifyReply,
    answer: (managers: GroupManager[]) => Promise<T> | T,
  ): Promise<T | FastifyReply> => {
    if (!allowManagerChange(actorId)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    // removeManager is idempotent and never sees the group, so check it here for every route.
    if (!(await getGroup(db, groupId))) return notFound(reply);
    try {
      const { changed, managers } = await change(db, groupId, targetId);
      const response = await answer(managers);
      if (changed) emitManagers(app.io, { groupId, managers });
      return response;
    } catch (error) {
      if (error instanceof GroupNotFoundError) return notFound(reply);
      if (error instanceof NotAnAdminError) return forbidden(reply);
      throw error;
    }
  };

  const changeMyManager =
    (change: typeof addManager) =>
    async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
      const actor = request.user!;
      if (!canBeManager(actor)) return forbidden(reply);
      const { id } = request.params;
      return applyManagerChange(
        actor.id,
        change,
        id,
        actor.id,
        reply,
        async (managers): Promise<ManagersResponse> => ({
          managers,
          managedByMe: managers.some((m) => m.id === actor.id),
          mode: await getEffectiveGroupMode(db, actor, id),
        }),
      );
    };

  const changeManager =
    (change: typeof addManager) =>
    async (request: FastifyRequest<MemberParams>, reply: FastifyReply) => {
      const actor = request.user!;
      if (!canSetManager(actor)) return forbidden(reply);
      const { id, userId } = request.params;
      return applyManagerChange(
        actor.id,
        change,
        id,
        userId,
        reply,
        (managers): GroupManagersResponse => ({ managers }),
      );
    };

  // `/managers/me` is registered first so `me` is never read as a user id.
  app.put<IdParams>(
    '/groups/:id/managers/me',
    { preHandler: adminOnly },
    changeMyManager(addManager),
  );
  app.delete<IdParams>(
    '/groups/:id/managers/me',
    { preHandler: adminOnly },
    changeMyManager(removeManager),
  );
  app.put<MemberParams>(
    '/groups/:id/managers/:userId',
    { preHandler: adminOnly },
    changeManager(addManager),
  );
  app.delete<MemberParams>(
    '/groups/:id/managers/:userId',
    { preHandler: adminOnly },
    changeManager(removeManager),
  );
};
