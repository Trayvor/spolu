import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { z, type ZodError } from 'zod';
import {
  ErrorCodes,
  IdSchema,
  KNOWLEDGE_LIMITS,
  KnowledgeDraftSchema,
  KnowledgeFolderDraftSchema,
  KnowledgeFolderPatchSchema,
  KnowledgePatchSchema,
  KnowledgeChatsFilterSchema,
  KnowledgeToFileSchema,
  KnowledgeTypeListSchema,
  MeetingSeriesScopeSchema,
  type KnowledgeFolderList,
  type KnowledgeScope,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { deleteDetachedFiles, InvalidAttachmentError } from '../files/service.js';
import { adminGroupId } from '../groups/admin-group.js';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';
import { getGroup } from '../groups/service.js';
import {
  AuthorRecipientError,
  InvalidRecipientError,
  InvalidReminderError,
  NoReminderSetError,
  NotReadableError,
  ReminderInPastError,
} from '../reminders/errors.js';
import {
  emitKnowledgeDeleted,
  emitKnowledgeFolder,
  emitKnowledgeFolderDeleted,
  emitKnowledgeItem,
} from './events.js';
import { createFolder, deleteFolder, listFolders, updateFolder } from './folders.js';
import { InvalidKnowledgeLinkError } from './links.js';
import { managedGroupIdsOf } from './scope.js';
import {
  canReadItemById,
  convertChatFile,
  createItem,
  deleteItem,
  FolderLimitError,
  getItem,
  InvalidFolderError,
  InvalidUrlError,
  InvalidVisibilityError,
  KnowledgeChangedError,
  KnowledgeFolderNotFoundError,
  KnowledgeForbiddenError,
  KnowledgeNotFoundError,
  listAllItems,
  listGroupItems,
  updateItem,
  ValidationError,
} from './service.js';
import { clientGroupIds } from '../groups/memberships.js';
import { readSubject } from '../notifications/subject-read.js';
import { markKnowledgeSeen } from '../notifications/unseen.js';
import { meetingAiOf, withMeetingAi } from './meeting-routes.js';
import { announceMeeting } from './meeting-realtime.js';
import { getItemSummary } from './service.js';
import { auditActorOf } from '../audit/request-actor.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

/**
 * `type`: one type, a comma list or repeated params (see `KnowledgeTypeListSchema`). `chats`:
 * `all` adds the files of the task and ticket chats; any other value is the group chat only.
 */
const filters = {
  type: KnowledgeTypeListSchema.optional(),
  chats: z
    .string()
    .max(20)
    .transform((value) => KnowledgeChatsFilterSchema.catch('group').parse(value))
    .optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
};
/** `folder`: the items directly in that folder, or `root` for the top level; absent: all. */
/** `shareable=1` (Phase 28, the chat's picker): only items that may be attached to a message. */
const GroupListQuerySchema = z.object({
  ...filters,
  folder: z.union([z.literal('root'), IdSchema]).optional(),
  shareable: z.literal('1').optional(),
  /**
   * `admin_group` (Phase 34, admins only): the picker's "eGrant tím" source in this group: the
   * admin group's items marked "Shareable with clients" instead of the group's own.
   */
  source: z.literal('admin_group').optional(),
});
/** `clients`: comma-separated group ids, at most 200. */
const GlobalListQuerySchema = z.object({
  ...filters,
  clients: z
    .string()
    .max(20_000)
    .transform((value) => value.split(',').filter((id) => id.length > 0))
    .pipe(z.array(IdSchema).max(KNOWLEDGE_LIMITS.clients))
    .optional(),
  // `all`: every group, whatever the admin manages; it never combines with `clients`.
  scope: z.literal('all').optional(),
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
  if (
    error instanceof KnowledgeNotFoundError ||
    error instanceof KnowledgeFolderNotFoundError ||
    error instanceof NotReadableError
  ) {
    return notFound(reply);
  }
  if (error instanceof InvalidFolderError) return send(reply, 400, ErrorCodes.invalidFolder);
  if (error instanceof FolderLimitError) return send(reply, 400, ErrorCodes.folderLimit);
  if (error instanceof NoReminderSetError) return send(reply, 404, ErrorCodes.noReminderSet);
  if (error instanceof KnowledgeForbiddenError) return send(reply, 403, ErrorCodes.forbidden);
  if (error instanceof KnowledgeChangedError) return send(reply, 409, ErrorCodes.knowledgeChanged);
  if (error instanceof InvalidVisibilityError) {
    return send(reply, 400, ErrorCodes.invalidVisibility);
  }
  if (error instanceof InvalidUrlError) return send(reply, 400, ErrorCodes.invalidUrl);
  if (error instanceof InvalidKnowledgeLinkError) {
    return send(reply, 400, ErrorCodes.invalidKnowledgeItem);
  }
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
export const knowledgeRoutes: FastifyPluginAsync<{
  deps: AppDeps;
  /** 120 writes per minute per user, shared with the reminder subscriptions (see app.ts). */
  allowWrite: (userId: string) => boolean;
}> = async (app, { deps, allowWrite }) => {
  const { db, storage } = deps;
  const anyUser = requireUser(app.auth);
  const adminOnly = requireAdmin(app.auth);
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };
  const writeGuard = [anyUser, limitWrites];

  /** True when the actor may read the group and it exists. */
  const canOpenGroup = async (actor: SessionUser, groupId: string): Promise<boolean> =>
    canReadGroup(actor, groupId, await clientGroupIds(db, actor.id)) &&
    (await getGroup(db, groupId)) !== null;

  app.get<IdParams>('/groups/:id/knowledge', { preHandler: anyUser }, async (request, reply) => {
    const query = GroupListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const actor = request.user!;
    if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
    const { type: types, folder, shareable, source, ...opts } = query.data;
    if (source === 'admin_group') {
      // Only an admin attaches the team's knowledge; a client never browses the admin group.
      if (!isAdmin(actor)) return notFound(reply);
      const adminId = await adminGroupId(db);
      if (adminId === null) return { items: [], nextCursor: null };
      try {
        return await listGroupItems(db, actor, adminId, { ...opts, types, shareable: true });
      } catch (error) {
        return knowledgeError(reply, error);
      }
    }
    try {
      return await listGroupItems(db, actor, request.params.id, {
        ...opts,
        types,
        folder: folder === 'root' ? null : folder,
        shareable: shareable === '1',
      });
    } catch (error) {
      return knowledgeError(reply, error);
    }
  });

  // Admins only: the service does no actor check of its own here.
  app.get('/knowledge', { preHandler: adminOnly }, async (request, reply) => {
    const query = GlobalListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const { clients, scope, type: types, ...opts } = query.data;
    if (scope === 'all' && clients !== undefined && clients.length > 0) return invalid(reply);
    let groupIds: string[] | null;
    if (scope === 'all') groupIds = null;
    else if (clients !== undefined && clients.length > 0) groupIds = clients;
    else {
      // The default scope: the admin's managed groups; none means every group.
      const managed = await managedGroupIdsOf(db, request.user!.id);
      groupIds = managed.length > 0 ? managed : null;
    }
    try {
      return await listAllItems(db, { ...opts, types, groupIds });
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
      // The group first: an unreadable or unknown group is 404 whatever the body.
      if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
      const body = KnowledgeDraftSchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, bodyErrorCode(body.error));
      const draft = body.data;
      // Phase 34: an item of the admin group is "Only eGrant" unless the body says otherwise.
      const given = (request.body as { visibility?: unknown } | null)?.visibility;
      if (given === undefined && (await adminGroupId(db)) === request.params.id) {
        draft.visibility = 'admins';
      }
      let item;
      let seriesItemIds: string[];
      try {
        ({ item, seriesItemIds } = await createItem(
          deps,
          actor,
          request.params.id,
          draft,
          auditActorOf(request),
        ));
      } catch (error) {
        return knowledgeError(reply, error);
      }
      // After the commit, outside the try: nothing here may be mapped as a failed write.
      emitKnowledgeItem(app.io, item);
      // The later calls of a new recurring series (ADR 0049).
      for (const id of seriesItemIds) await announceMeeting(db, id);
      return reply.code(201).send(withMeetingAi(item, actor, meetingAiOf(deps)));
    },
  );

  app.get<IdParams>('/knowledge/:id', { preHandler: anyUser }, async (request, reply) => {
    try {
      const item = await getItem(db, request.user!, request.params.id);
      return withMeetingAi(item, request.user!, meetingAiOf(deps));
    } catch (error) {
      return knowledgeError(reply, error);
    }
  });

  // 2026-10-18: the viewer opened the item: a mention in its body from before is read on the
  // Mentions card. 2026-10-19 (ADR 0060): and their notification centre items about it (its
  // reminders, a meeting's summary) are read.
  app.post<IdParams>('/knowledge/:id/seen', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await canReadItemById(db, actor, request.params.id))) {
      return knowledgeError(reply, new KnowledgeNotFoundError());
    }
    await markKnowledgeSeen(db, actor.id, request.params.id);
    await readSubject(db, app.io, actor.id, { kind: 'knowledge', id: request.params.id });
    return reply.code(204).send();
  });

  app.patch<IdParams>('/knowledge/:id', { preHandler: writeGuard }, async (request, reply) => {
    const body = KnowledgePatchSchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, bodyErrorCode(body.error));
    let result;
    try {
      result = await updateItem(
        deps,
        request.user!,
        request.params.id,
        body.data,
        auditActorOf(request),
      );
    } catch (error) {
      return knowledgeError(reply, error);
    }
    const { item, previousVisibility, removedFileIds, following } = result;
    // The files taken off the item were detached in the transaction. Not awaited: the answer does
    // not wait for storage, and a failed delete leaves them to the daily unattached cleanup.
    void deleteDetachedFiles({ db, storage }, removedFileIds).catch((error: unknown) =>
      request.log.error({ err: error }, 'could not delete the files of a knowledge item'),
    );
    emitKnowledgeItem(app.io, item, previousVisibility);
    // "This and following" of a recurring call (ADR 0049): the later calls' rows.
    for (const changed of following) {
      const rows = await getItemSummary(db, changed.id);
      if (rows) emitKnowledgeItem(app.io, rows.admin, changed.previousVisibility, rows.client);
    }
    return withMeetingAi(item, request.user!, meetingAiOf(deps));
  });

  // A chat file becomes a normal file item (one way). Lists follow through `knowledge:item`: a
  // known item of another type leaves a "From chat" list and joins its folder's.
  app.post<IdParams>(
    '/knowledge/:id/to-file',
    { preHandler: writeGuard },
    async (request, reply) => {
      const body = KnowledgeToFileSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      let result;
      try {
        result = await convertChatFile(deps, request.user!, request.params.id, body.data);
      } catch (error) {
        return knowledgeError(reply, error);
      }
      emitKnowledgeItem(app.io, result.item, result.previousVisibility);
      return withMeetingAi(result.item, request.user!, meetingAiOf(deps));
    },
  );

  // `?scope=following` (ADR 0049): a recurring call and the later calls of its series.
  app.delete<IdParams>('/knowledge/:id', { preHandler: writeGuard }, async (request, reply) => {
    const query = z
      .object({ scope: MeetingSeriesScopeSchema.optional() })
      .safeParse(request.query ?? {});
    if (!query.success) return invalid(reply);
    let result;
    try {
      result = await deleteItem(
        deps,
        request.user!,
        request.params.id,
        query.data.scope,
        auditActorOf(request),
      );
    } catch (error) {
      return knowledgeError(reply, error);
    }
    for (const deleted of result.deleted) emitKnowledgeDeleted(app.io, deleted);
    return reply.code(204).send();
  });

  // Folders (Phase 24): every folder the actor sees, then create, change and delete.
  app.get<IdParams>(
    '/groups/:id/knowledge/folders',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
      try {
        const list: KnowledgeFolderList = {
          folders: await listFolders(db, actor, request.params.id),
        };
        return list;
      } catch (error) {
        return knowledgeError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/groups/:id/knowledge/folders',
    { preHandler: writeGuard },
    async (request, reply) => {
      const actor = request.user!;
      if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
      const body = KnowledgeFolderDraftSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      let folder;
      try {
        folder = await createFolder(db, actor, request.params.id, body.data, auditActorOf(request));
      } catch (error) {
        return knowledgeError(reply, error);
      }
      emitKnowledgeFolder(app.io, folder);
      return reply.code(201).send(folder);
    },
  );

  app.patch<IdParams>(
    '/knowledge/folders/:id',
    { preHandler: writeGuard },
    async (request, reply) => {
      const body = KnowledgeFolderPatchSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      let result;
      try {
        result = await updateFolder(
          db,
          request.user!,
          request.params.id,
          body.data,
          auditActorOf(request),
        );
      } catch (error) {
        return knowledgeError(reply, error);
      }
      emitKnowledgeFolder(app.io, result.folder, result.previousVisibility, result.hiddenItemIds);
      return result.folder;
    },
  );

  app.delete<IdParams>(
    '/knowledge/folders/:id',
    { preHandler: writeGuard },
    async (request, reply) => {
      let deleted;
      try {
        deleted = await deleteFolder(db, request.user!, request.params.id, auditActorOf(request));
      } catch (error) {
        return knowledgeError(reply, error);
      }
      emitKnowledgeFolderDeleted(app.io, deleted);
      return reply.code(204).send();
    },
  );
};
