import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ErrorCodes, GroupInputSchema, type Group } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { disconnectUser } from '../../infra/realtime/rooms.js';
import { requireUser } from '../auth/session.js';
import { revokeAllSessions } from '../auth/service.js';
import { deactivateUser, getUserById, reactivateUser } from '../users/service.js';
import { logoRoutes } from './logo.js';
import { canManageGroups, canReadGroup, canRemoveMember } from './policy.js';
import {
  createGroup,
  EgrantUrlTakenError,
  getGroup,
  getMembershipGroupId,
  InvalidEgrantUrlError,
  listGroups,
  listMembers,
  regenerateInvite,
  updateGroup,
  type GroupRow,
} from './service.js';

type IdParams = { Params: { id: string } };
type MemberParams = { Params: { id: string; userId: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });

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
    return listGroups(db);
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
    if (!canReadGroup(actor, id, await getMembershipGroupId(db, actor.id))) return notFound(reply);
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
    if (!canReadGroup(actor, id, await getMembershipGroupId(db, actor.id))) return notFound(reply);
    if (!(await getGroup(db, id))) return notFound(reply);
    return listMembers(db, id, { removed: false });
  });

  app.get<IdParams>(
    '/groups/:id/members/removed',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      if (!(await getGroup(db, request.params.id))) return notFound(reply);
      return listMembers(db, request.params.id, { removed: true });
    },
  );

  /** The target of remove/restore: a user who is a member of this group, else null (404). */
  const groupMember = async (groupId: string, userId: string) => {
    const target = await getUserById(db, userId);
    if (!target || (await getMembershipGroupId(db, userId)) !== groupId) return null;
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
      await deactivateUser(db, target.id);
      await revokeAllSessions(db, target.id);
      disconnectUser(app.io, target.id);
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
      await reactivateUser(db, target.id);
      return reply.code(204).send();
    },
  );
};
