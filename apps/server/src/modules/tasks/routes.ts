import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import {
  BoardDoneQuerySchema,
  BoardQuerySchema,
  BucketCreateSchema,
  BucketPatchSchema,
  TaskSearchQuerySchema,
  ErrorCodes,
  type BoardUnseen,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { getGroup } from '../groups/service.js';
import { emitAdminActivity } from '../../infra/realtime/rooms.js';
import { InvalidTaskSearchCursorError, searchTasks } from './attachable.js';
import { emitBuckets } from './events.js';
import { canManageBuckets, canUseBoard } from './policy.js';
import { taskRoutes } from './task-routes.js';
import {
  createBucket,
  deleteBucket,
  FixedBucketError,
  getBoard,
  getBucket,
  getDonePage,
  InvalidPlacementError,
  listBuckets,
  listUnseenTaskIds,
  updateBucket,
} from './service.js';
import { clientGroupIds } from '../groups/memberships.js';

type GroupParams = { Params: { id: string } };

/** The preHandlers of every board write route: a logged-in user, then the shared rate limit. */
export type WriteGuard = preHandlerAsyncHookHandler[];

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });
const invalid = (reply: FastifyReply) =>
  reply.code(400).send({ error: ErrorCodes.validationFailed });

export const tasksRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  // One budget for all board writes (tasks and buckets), per user.
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
  };
  /** Shared with the task routes. */
  const writeGuard: WriteGuard = [anyUser, limitWrites];

  /** True when the actor may open the board of `groupId` and the group exists. */
  const canOpenGroup = async (actor: SessionUser, groupId: string): Promise<boolean> =>
    canUseBoard(actor, groupId, await clientGroupIds(db, actor.id)) &&
    (await getGroup(db, groupId)) !== null;

  await app.register(taskRoutes, { deps, writeGuard, canOpenGroup });

  // Phase 34: the attachment picker's Tasks tab, for the readers of the group's board.
  app.get<GroupParams>(
    '/groups/:id/tasks/search',
    { preHandler: anyUser },
    async (request, reply) => {
      const query = TaskSearchQuerySchema.safeParse(request.query);
      if (!query.success) return invalid(reply);
      if (!(await canOpenGroup(request.user!, request.params.id))) return notFound(reply);
      try {
        return await searchTasks(db, request.params.id, query.data);
      } catch (error) {
        if (error instanceof InvalidTaskSearchCursorError) return invalid(reply);
        throw error;
      }
    },
  );

  app.get<GroupParams>('/groups/:id/board', { preHandler: anyUser }, async (request, reply) => {
    const query = BoardQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    // Group check first: ensureBoard must never run for an unknown group.
    if (!(await canOpenGroup(request.user!, request.params.id))) return notFound(reply);
    return getBoard(db, request.params.id, { done: query.data.done });
  });

  // 2026-10-17: the cards with a change the viewer has not seen (per viewer, so not in the board).
  app.get<GroupParams>(
    '/groups/:id/board/unseen',
    { preHandler: anyUser },
    async (request, reply): Promise<BoardUnseen> => {
      const actor = request.user!;
      if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
      return { taskIds: await listUnseenTaskIds(db, actor.id, request.params.id) };
    },
  );

  // "Show more" in the Completed column (Phase 27 S8).
  app.get<GroupParams>(
    '/groups/:id/board/done',
    { preHandler: anyUser },
    async (request, reply) => {
      const query = BoardDoneQuerySchema.safeParse(request.query);
      if (!query.success) return invalid(reply);
      if (!(await canOpenGroup(request.user!, request.params.id))) return notFound(reply);
      return getDonePage(db, request.params.id, query.data.after);
    },
  );

  app.post<GroupParams>(
    '/groups/:id/buckets',
    { preHandler: writeGuard },
    async (request, reply) => {
      const actor = request.user!;
      const body = BucketCreateSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
      if (!canManageBuckets(actor)) return forbidden(reply);
      const bucket = await createBucket(db, request.params.id, body.data.name);
      emitBuckets(app.io, bucket.groupId, await listBuckets(db, bucket.groupId));
      return reply.code(201).send(bucket);
    },
  );

  app.patch<GroupParams>('/buckets/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = BucketPatchSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const current = await getBucket(db, request.params.id);
    if (!current || !(await canOpenGroup(actor, current.groupId))) return notFound(reply);
    if (!canManageBuckets(actor)) return forbidden(reply);
    try {
      const bucket = await updateBucket(db, current.id, body.data);
      if (!bucket) return notFound(reply);
      emitBuckets(app.io, bucket.groupId, await listBuckets(db, bucket.groupId));
      return bucket;
    } catch (error) {
      if (error instanceof FixedBucketError) {
        return reply.code(400).send({ error: ErrorCodes.fixedBucket });
      }
      if (error instanceof InvalidPlacementError) return invalid(reply);
      throw error;
    }
  });

  app.delete<GroupParams>('/buckets/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const current = await getBucket(db, request.params.id);
    if (!current || !(await canOpenGroup(actor, current.groupId))) return notFound(reply);
    if (!canManageBuckets(actor)) return forbidden(reply);
    try {
      const deleted = await deleteBucket(db, current.id);
      if (!deleted) return notFound(reply);
      emitBuckets(app.io, deleted.groupId, await listBuckets(db, deleted.groupId));
      // Its tasks moved to To do: the admin home's global board must refetch.
      emitAdminActivity(app.io, { groupId: deleted.groupId, kind: 'task' });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof FixedBucketError) {
        return reply.code(400).send({ error: ErrorCodes.fixedBucket });
      }
      throw error;
    }
  });
};
