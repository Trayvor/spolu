import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  AdminGroupInputSchema,
  ErrorCodes,
  GroupInputSchema,
  GroupListQuerySchema,
  InviteMemberBodySchema,
  type Group,
  type InviteContext,
  type GroupManager,
  type GroupManagersResponse,
  type ManagersResponse,
  type MeGroup,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Config } from '../../infra/config/config.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { disconnectUser, joinGroupRoom, leaveGroupRoom } from '../../infra/realtime/rooms.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { memberAddedEmail, memberInvitedEmail } from '../auth/emails.js';
import { pickLanguage } from '../auth/language.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { revokeAllSessions } from '../auth/service.js';
import { getEffectiveGroupMode } from '../notifications/modes.js';
import {
  deactivateUser,
  EmailTakenError,
  findUserByEmail,
  getUserById,
  reactivateUser,
} from '../users/service.js';
import { isAdminGroup } from './admin-group.js';
import { isDeactivated, setGroupActive } from './deactivation.js';
import { emitManagers } from './events.js';
import { inviteLoginUrl, verifyInviteToken } from './invite-token.js';
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
  AlreadyMemberError,
  createGroup,
  EgrantUrlTakenError,
  getGroup,
  InvalidEgrantUrlError,
  inviteMember,
  listGroupPeople,
  InvalidGroupCursorError,
  listGroups,
  listGroupsPage,
  listInvitedMembers,
  listMembers,
  MemberRemovedError,
  regenerateInvite,
  renameAdminGroup,
  updateGroup,
  type GroupRow,
} from './service.js';
import {
  cancelInvitedMembership,
  clientGroupIds,
  getMembership,
  listMemberships,
  removeMembership,
  restoreMembership,
} from './memberships.js';
import { auditActorOf } from '../audit/request-actor.js';
import { revokeAllTokens } from '../mcp/tokens.js';

type IdParams = { Params: { id: string } };
type MemberParams = { Params: { id: string; userId: string } };

/** Invitation context lookups a minute from one IP address (no session). */
const CONTEXT_PER_MINUTE = 30;
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });
/** The admin group has no members, invites or managers (Phase 34). */
const adminGroupRefused = (reply: FastifyReply) =>
  reply.code(409).send({ error: ErrorCodes.adminGroup });

/** Calls a minute per admin to become or stop being a manager. */
export const managerRateLimit = (config: Config): number => config.managerRateLimitPerMinute ?? 120;

/** Members an admin may add by email per minute. */
const INVITES_PER_MINUTE = 30;

export const groupsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { config, db, jobs } = deps;
  await app.register(logoRoutes, { deps });
  const anyUser = requireUser(app.auth);

  const inviteUrl = (token: string): string => `${config.publicUrl}/join/${token}`;
  const toGroup = (row: GroupRow, withInvite: boolean): Group => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    egrantUrl: row.egrantUrl,
    hasLogo: row.logoKey !== null,
    updatedAt: row.updatedAt.toISOString(),
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    // The admin group's token is never shown.
    ...(withInvite && !isAdminGroup(row) ? { inviteUrl: inviteUrl(row.inviteToken) } : {}),
  });

  /**
   * A client group for a members, invite or manager route: sends 404 for an unknown id and
   * `409 admin_group` for the admin group, and returns null then.
   */
  const clientGroupOr = async (id: string, reply: FastifyReply): Promise<GroupRow | null> => {
    const group = await getGroup(db, id);
    if (!group) {
      notFound(reply);
      return null;
    }
    if (isAdminGroup(group)) {
      adminGroupRefused(reply);
      return null;
    }
    return group;
  };

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

  /**
   * The caller's own active memberships with their role, as `/api/me` lists them (ADR 0071): a
   * session route the MCP tools can call as the user (`/api/me` reads the cookie itself). Empty
   * for admins, whose clients are `GET /groups`.
   */
  app.get('/me/groups', { preHandler: anyUser }, async (request): Promise<MeGroup[]> =>
    (await listMemberships(db, request.user!.id)).map((m) => ({
      id: m.groupId,
      name: m.name,
      role: m.role,
      hasLogo: m.hasLogo,
      updatedAt: m.updatedAt.toISOString(),
    })),
  );

  app.get('/groups', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    const query = GroupListQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    const { limit, cursor, q } = query.data;
    const deactivated = query.data.deactivated === 'true';
    // No limit: every group, as the filter lists expect. A limit: one page (2026-10-18).
    if (limit === undefined) return listGroups(db, request.user!.id, { q, deactivated });
    try {
      return await listGroupsPage(db, request.user!.id, { q, limit, cursor, deactivated });
    } catch (error) {
      if (error instanceof InvalidGroupCursorError) {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      throw error;
    }
  });

  // Deactivate and reactivate a client group (admins). Nothing is deleted; the webhook
  // (`egrant-groups-routes.ts`) goes through the same `setGroupActive`.
  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    app.post<IdParams>(`/groups/:id/${path}`, { preHandler: anyUser }, async (request, reply) => {
      const actor = request.user!;
      if (!canManageGroups(actor)) return forbidden(reply);
      const group = await clientGroupOr(request.params.id, reply);
      if (!group) return reply;
      const result = await setGroupActive(
        { db, io: app.io },
        group.id,
        active,
        auditActorOf(request),
      );
      if (!result) return notFound(reply);
      if (result.changed) {
        request.log.info({ groupId: group.id, actorId: actor.id, active }, 'group status changed');
      }
      return toGroup(result.group, true);
    });
  }

  app.post('/groups', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    const body = GroupInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      return reply
        .code(201)
        .send(toGroup(await createGroup(db, body.data, auditActorOf(request)), true));
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
    const existing = await getGroup(db, request.params.id);
    if (!existing) return notFound(reply);
    if (isAdminGroup(existing)) {
      // Name only: the admin group has no eGrant URL.
      const named = AdminGroupInputSchema.safeParse(request.body);
      if (!named.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      const renamed = await renameAdminGroup(
        db,
        existing.id,
        named.data.name,
        auditActorOf(request),
      );
      return renamed ? toGroup(renamed, true) : notFound(reply);
    }
    const body = GroupInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      const group = await updateGroup(db, request.params.id, body.data, auditActorOf(request));
      return group ? toGroup(group, true) : notFound(reply);
    } catch (error) {
      return groupWriteError(error, reply);
    }
  });

  app.post<IdParams>('/groups/:id/invite', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    // Check first: regenerateInvite throws a plain Error for an unknown id.
    const group = await clientGroupOr(request.params.id, reply);
    if (!group) return reply;
    if (isDeactivated(group)) return reply.code(409).send({ error: ErrorCodes.groupInactive });
    return {
      inviteUrl: inviteUrl(await regenerateInvite(db, request.params.id, auditActorOf(request))),
    };
  });

  app.get<IdParams>('/groups/:id/members', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    const group = await getGroup(db, id);
    // The admin group has no Members tab (Phase 34).
    if (!group || isAdminGroup(group)) return notFound(reply);
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
    if (!(await clientGroupOr(id, reply))) return reply;
    return listMembers(db, id, { removed: false, role: 'ziadatel' });
  });

  app.get<IdParams>(
    '/groups/:id/requesters/removed',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      if (!(await clientGroupOr(request.params.id, reply))) return reply;
      return listMembers(db, request.params.id, { removed: true, role: 'ziadatel' });
    },
  );

  app.get<IdParams>(
    '/groups/:id/members/removed',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      if (!(await clientGroupOr(request.params.id, reply))) return reply;
      return listMembers(db, request.params.id, { removed: true });
    },
  );

  // Adding members by email (Phase 22b): admins only. An admin's invite is a client membership
  // at once; "Pozvaný" is that membership while the person has never signed in.
  const allowInvite = createRateLimiter({ windowMs: 60_000, max: INVITES_PER_MINUTE });

  app.post<IdParams>('/groups/:id/members', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!canManageGroups(actor)) return forbidden(reply);
    if (!allowInvite(actor.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    const group = await clientGroupOr(request.params.id, reply);
    if (!group) return reply;
    if (isDeactivated(group)) return reply.code(409).send({ error: ErrorCodes.groupInactive });
    const body = InviteMemberBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });

    let invited;
    try {
      invited = await inviteMember(db, group.id, body.data, auditActorOf(request));
    } catch (error) {
      if (error instanceof AlreadyMemberError) {
        return reply.code(409).send({ error: ErrorCodes.alreadyMember });
      }
      if (error instanceof MemberRemovedError) {
        return reply.code(409).send({ error: ErrorCodes.removedMember, userId: error.userId });
      }
      if (error instanceof EmailTakenError) {
        return reply.code(409).send({ error: ErrorCodes.emailTakenAdmin });
      }
      throw error;
    }
    const { member, outcome } = invited;
    if (outcome === 'added') joinGroupRoom(app.io, member.id, group.id);

    // The membership is committed; a failed email must not turn this into an error.
    try {
      // A signed-in client chose a language; a new person gets the inviting admin's.
      const lang =
        outcome === 'added'
          ? ((await getUserById(db, member.id))?.language ??
            pickLanguage(request.headers['accept-language']))
          : pickLanguage(request.headers['accept-language']);
      const to = { to: member.email, lang, publicUrl: config.publicUrl };
      const email =
        outcome === 'added'
          ? memberAddedEmail(to, {
              groupName: group.name,
              addedBy: actor.name,
              groupUrl: `${config.publicUrl}/groups/${group.id}`,
            })
          : memberInvitedEmail(to, {
              groupName: group.name,
              invitedBy: actor.name,
              loginUrl: inviteLoginUrl(config.publicUrl, config.appSecret, {
                groupId: group.id,
                invitedBy: actor.name,
                email: member.email,
              }),
            });
      await sendEmailLater(jobs, email);
    } catch (error) {
      request.log.error({ err: error }, 'could not queue the member invite email');
    }
    return reply.code(outcome === 'resent' ? 200 : 201).send({ member, outcome });
  });

  // X19: the signed context of an invitation link, for `/login` and `/welcome` (no session). It
  // answers only with the invited email, while that person is still an active member of the
  // group and the group is not deactivated; anything else is 404, as a missing group. Public, so
  // limited per IP address like the other routes without a session (review V11).
  const allowContext = createRateLimiter({ windowMs: 60_000, max: CONTEXT_PER_MINUTE });
  app.get<{ Querystring: { token?: unknown; email?: unknown } }>(
    '/invitations/context',
    async (request, reply) => {
      if (!allowContext(request.ip)) {
        return reply.code(429).send({ error: ErrorCodes.rateLimited });
      }
      const { token, email } = request.query;
      if (typeof token !== 'string' || typeof email !== 'string' || token.length > 2000) {
        return notFound(reply);
      }
      const signed = verifyInviteToken(config.appSecret, token, email);
      if (!signed) return notFound(reply);
      const [group, person] = await Promise.all([
        getGroup(db, signed.groupId),
        findUserByEmail(db, email.trim().toLowerCase()),
      ]);
      const membership = person ? await getMembership(db, person.id, signed.groupId) : null;
      if (!group || isDeactivated(group) || !membership || membership.removedAt !== null) {
        return notFound(reply);
      }
      const answer: InviteContext = { groupName: group.name, invitedBy: signed.invitedBy };
      return answer;
    },
  );

  app.get<IdParams>(
    '/groups/:id/members/invited',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      if (!(await clientGroupOr(request.params.id, reply))) return reply;
      return listInvitedMembers(db, request.params.id);
    },
  );

  // Cancels an invite: only a never-signed-in client; removing a member stays `DELETE /members/:userId`.
  app.delete<MemberParams>(
    '/groups/:id/members/invited/:userId',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      const { id, userId } = request.params;
      if (!(await clientGroupOr(id, reply))) return reply;
      if (!(await cancelInvitedMembership(db, id, userId, auditActorOf(request)))) {
        return notFound(reply);
      }
      return reply.code(204).send();
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
      if (!(await clientGroupOr(request.params.id, reply))) return reply;
      const target = await groupMember(request.params.id, request.params.userId);
      if (!target) return notFound(reply);
      if (!canRemoveMember(request.user!, target)) return forbidden(reply);
      // Removed from this group only; with no active membership left they are signed out.
      const { lastActive } = await removeMembership(
        db,
        request.params.id,
        target.id,
        auditActorOf(request),
      );
      if (lastActive) {
        await deactivateUser(db, target.id, auditActorOf(request));
        await revokeAllSessions(db, target.id);
        disconnectUser(app.io, target.id);
      } else {
        leaveGroupRoom(app.io, target.id, request.params.id);
        // No longer a manager of any client (a žiadateľ elsewhere at most): no MCP (ADR 0071).
        if ((await clientGroupIds(db, target.id)).length === 0)
          await revokeAllTokens(db, target.id);
      }
      return reply.code(204).send();
    },
  );

  app.post<MemberParams>(
    '/groups/:id/members/:userId/restore',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!canManageGroups(request.user!)) return forbidden(reply);
      const group = await clientGroupOr(request.params.id, reply);
      if (!group) return reply;
      if (isDeactivated(group)) return reply.code(409).send({ error: ErrorCodes.groupInactive });
      const target = await groupMember(request.params.id, request.params.userId);
      if (!target) return notFound(reply);
      if (!canRemoveMember(request.user!, target)) return forbidden(reply);
      await restoreMembership(db, request.params.id, target.id, auditActorOf(request));
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
    request: FastifyRequest,
    change: typeof addManager,
    groupId: string,
    targetId: string,
    reply: FastifyReply,
    answer: (managers: GroupManager[]) => Promise<T> | T,
  ): Promise<T | FastifyReply> => {
    if (!allowManagerChange(request.user!.id)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    // removeManager is idempotent and never sees the group, so check it here for every route.
    // The admin group has no managers: every admin is effectively one (Phase 34).
    if (!(await clientGroupOr(groupId, reply))) return reply;
    try {
      const { changed, managers } = await change(db, groupId, targetId, auditActorOf(request));
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
        request,
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
        request,
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
