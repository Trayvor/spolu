import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { z, type ZodError } from 'zod';
import {
  ErrorCodes,
  IdSchema,
  KNOWLEDGE_LIMITS,
  KnowledgeDraftSchema,
  KnowledgePatchSchema,
  KnowledgeTypes,
  type KnowledgeScope,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { deleteDetachedFiles, InvalidAttachmentError } from '../files/service.js';
import { canReadGroup } from '../groups/policy.js';
import { getGroup, getMembershipGroupId } from '../groups/service.js';
import {
  AuthorRecipientError,
  InvalidRecipientError,
  InvalidReminderError,
  NoReminderSetError,
  NotReadableError,
  ReminderInPastError,
} from '../reminders/errors.js';
import { emitKnowledgeDeleted, emitKnowledgeItem } from './events.js';
import { managedGroupIdsOf } from './scope.js';
import {
  createItem,
  deleteItem,
  getItem,
  InvalidUrlError,
  InvalidVisibilityError,
  KnowledgeChangedError,
  KnowledgeForbiddenError,
  KnowledgeNotFoundError,
  listAllItems,
  listGroupItems,
  updateItem,
  ValidationError,
} from './service.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

const filters = {
  type: z.enum(KnowledgeTypes).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
};
const GroupListQuerySchema = z.object(filters);
/** `clients`: comma-separated group ids, at most 200. */
const GlobalListQuerySchema = z.object({
  ...filters,
  clients: z
    .string()
    .max(20_000)
    .transform((value) => value.split(',').filter((id) => id.length > 0))
    .pipe(z.array(IdSchema).max(KNOWLEDGE_LIMITS.clients))
    .optional(),
});

/**
 * 400 for a body that failed the draft or patch schema: the URL, the reminder times and the
 * recipients have their own codes.
 */
function bodyErrorCode(error: ZodError): string {
  const at = (...path: string[]) =>
    error.issues.some((issue) => path.every((key, i) => issue.path[i] === key));
  if (at('url')) return ErrorCodes.invalidUrl;
  if (at('reminder', 'times')) return ErrorCodes.invalidReminder;
  if (at('reminder', 'recipientIds')) return ErrorCodes.invalidRecipient;
  return ErrorCodes.validationFailed;
}

/** Maps the expected service errors; anything else is rethrown (500). */
export function knowledgeError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof KnowledgeNotFoundError || error instanceof NotReadableError) {
    return notFound(reply);
  }
  if (error instanceof NoReminderSetError) return send(reply, 404, ErrorCodes.noReminderSet);
  if (error instanceof KnowledgeForbiddenError) return send(reply, 403, ErrorCodes.forbidden);
  if (error instanceof KnowledgeChangedError) return send(reply, 409, ErrorCodes.knowledgeChanged);
  if (error instanceof InvalidVisibilityError) {
    return send(reply, 400, ErrorCodes.invalidVisibility);
  }
  if (error instanceof InvalidUrlError) return send(reply, 400, ErrorCodes.invalidUrl);
  if (error instanceof InvalidAttachmentError) {
    return send(reply, 400, ErrorCodes.invalidAttachment);
  }
  if (error instanceof InvalidReminderError) return send(reply, 400, ErrorCodes.invalidReminder);
  if (error instanceof ReminderInPastError) return send(reply, 400, ErrorCodes.reminderInPast);
  if (error instanceof InvalidRecipientError) return send(reply, 400, ErrorCodes.invalidRecipient);
  if (error instanceof AuthorRecipientError) return send(reply, 400, ErrorCodes.authorRecipient);
  if (error instanceof ValidationError) return invalid(reply);
  throw error;
}

/** The knowledge tab, the global list for admins, and item reads and writes. */
export const knowledgeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, storage } = deps;
  const anyUser = requireUser(app.auth);
  const adminOnly = requireAdmin(app.auth);
  // 120 knowledge writes per minute per user, as the board.
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };
  const writeGuard = [anyUser, limitWrites];

  /** True when the actor may read the group and it exists. */
  const canOpenGroup = async (actor: SessionUser, groupId: string): Promise<boolean> =>
    canReadGroup(actor, groupId, await getMembershipGroupId(db, actor.id)) &&
    (await getGroup(db, groupId)) !== null;

  app.get<IdParams>('/groups/:id/knowledge', { preHandler: anyUser }, async (request, reply) => {
    const query = GroupListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const actor = request.user!;
    if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
    try {
      return await listGroupItems(db, actor, request.params.id, query.data);
    } catch (error) {
      return knowledgeError(reply, error);
    }
  });

  // Admins only: the service does no actor check of its own here.
  app.get('/knowledge', { preHandler: adminOnly }, async (request, reply) => {
    const query = GlobalListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const { clients, ...opts } = query.data;
    let groupIds: string[] | null;
    if (clients !== undefined && clients.length > 0) groupIds = clients;
    else {
      // The default scope: the admin's managed groups; none (null or empty) means every group.
      const managed = await managedGroupIdsOf(db, request.user!.id);
      groupIds = managed !== null && managed.length > 0 ? managed : null;
    }
    try {
      return await listAllItems(db, { ...opts, groupIds });
    } catch (error) {
      return knowledgeError(reply, error);
    }
  });

  app.get('/knowledge/scope', { preHandler: adminOnly }, async (request) => {
    const scope: KnowledgeScope = {
      managedGroupIds: await managedGroupIdsOf(db, request.user!.id),
    };
    return scope;
  });

  app.post<IdParams>(
    '/groups/:id/knowledge',
    { preHandler: writeGuard },
    async (request, reply) => {
      const actor = request.user!;
      const body = KnowledgeDraftSchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, bodyErrorCode(body.error));
      if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
      let item;
      try {
        ({ item } = await createItem(deps, actor, request.params.id, body.data));
      } catch (error) {
        return knowledgeError(reply, error);
      }
      // After the commit, outside the try: nothing here may be mapped as a failed write.
      emitKnowledgeItem(app.io, item);
      return reply.code(201).send(item);
    },
  );

  app.get<IdParams>('/knowledge/:id', { preHandler: anyUser }, async (request, reply) => {
    try {
      return await getItem(db, request.user!, request.params.id);
    } catch (error) {
      return knowledgeError(reply, error);
    }
  });

  app.patch<IdParams>('/knowledge/:id', { preHandler: writeGuard }, async (request, reply) => {
    const body = KnowledgePatchSchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, bodyErrorCode(body.error));
    let result;
    try {
      result = await updateItem(deps, request.user!, request.params.id, body.data);
    } catch (error) {
      return knowledgeError(reply, error);
    }
    const { item, previousVisibility, removedFileIds } = result;
    // The files taken off the item were detached in the transaction; a failed delete leaves them
    // to the daily unattached cleanup.
    await deleteDetachedFiles({ db, storage }, removedFileIds).catch((error: unknown) =>
      request.log.error({ err: error }, 'could not delete the files of a knowledge item'),
    );
    emitKnowledgeItem(app.io, item, previousVisibility);
    return item;
  });

  app.delete<IdParams>('/knowledge/:id', { preHandler: writeGuard }, async (request, reply) => {
    let deleted;
    try {
      deleted = await deleteItem(deps, request.user!, request.params.id);
    } catch (error) {
      return knowledgeError(reply, error);
    }
    emitKnowledgeDeleted(app.io, { ...deleted, id: request.params.id });
    return reply.code(204).send();
  });
};
