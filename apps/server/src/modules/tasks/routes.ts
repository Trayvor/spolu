import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { BucketCreateSchema, BucketPatchSchema, ErrorCodes, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { getGroup, getMembershipGroupId } from '../groups/service.js';
import { emitBuckets } from './events.js';
import { canManageBuckets, canUseBoard } from './policy.js';
import {
  createBucket,
  deleteBucket,
  FixedBucketError,
  getBoard,
  getBucket,
  InvalidPlacementError,
  listBuckets,
  updateBucket,
} from './service.js';

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
  /** Reused by the task routes (Task 3). */
  const writeGuard: WriteGuard = [anyUser, limitWrites];

  /** True when the actor may open the board of `groupId` and the group exists. */
  const canOpenGroup = async (actor: SessionUser, groupId: string): Promise<boolean> =>
    canUseBoard(actor, groupId, await getMembershipGroupId(db, actor.id)) &&
    (await getGroup(db, groupId)) !== null;

  app.get<GroupParams>('/groups/:id/board', { preHandler: anyUser }, async (request, reply) => {
    // Group check first: ensureBoard must never run for an unknown group.
    if (!(await canOpenGroup(request.user!, request.params.id))) return notFound(reply);
    return getBoard(db, request.params.id);
  });

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
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof FixedBucketError) {
        return reply.code(400).send({ error: ErrorCodes.fixedBucket });
      }
      throw error;
    }
  });
};
