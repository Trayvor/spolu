import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import {
  ErrorCodes,
  FinanceFolderBodySchema,
  FinanceFolderPatchSchema,
  FinanceItemBodySchema,
  FinanceItemPatchSchema,
  FinanceItemsQuerySchema,
  FinanceItemViewQuerySchema,
  FinanceOrgItemBodySchema,
  type FinancePerson,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { decodeFileNameHeader } from '../files/file-name.js';
import { FileTooLargeError, InvalidAttachmentError, MAX_FILE_BYTES } from '../files/service.js';
import { isAdminGroup } from '../groups/admin-group.js';
import { getGroup } from '../groups/service.js';
import { listAdmins, listFinanceHolders } from '../users/service.js';
import {
  createItem,
  createOrgItem,
  deleteItem,
  getItem,
  InvalidCursorError,
  listItems,
  updateItem,
} from './documents.js';
import {
  FinanceAdminGroupShareError,
  FinanceChangedError,
  FinanceFolderCycleError,
  FinanceFolderLimitError,
  FinanceNotFoundError,
  FinanceValidationError,
} from './errors.js';
import { InvalidProjectError } from './project-links.js';
import { emitFinanceChanged } from './events.js';
import { uploadFinanceFile } from './files.js';
import { createFolder, deleteFolder, listFolders, updateFolder } from './folders.js';
import { canBePayee, canManageOrgFinance } from './policy.js';
import { registerFinanceReminderSubject } from './reminder-subject.js';

// The fire job and the reminder routes find the `finance` kind through the registry.
registerFinanceReminderSubject();

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

/** Maps the expected errors of the documents; anything else is rethrown (500). */
function documentsError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof FinanceNotFoundError) return notFound(reply);
  if (error instanceof FinanceAdminGroupShareError) {
    return send(reply, 400, ErrorCodes.invalidGroup);
  }
  if (error instanceof FinanceChangedError) return send(reply, 409, ErrorCodes.financeChanged);
  if (error instanceof FinanceFolderCycleError) return send(reply, 400, ErrorCodes.invalidFolder);
  if (error instanceof FinanceFolderLimitError) return send(reply, 400, ErrorCodes.folderLimit);
  if (error instanceof InvalidAttachmentError) {
    return send(reply, 400, ErrorCodes.invalidAttachment);
  }
  if (error instanceof FinanceValidationError || error instanceof InvalidCursorError) {
    return invalid(reply);
  }
  if (error instanceof InvalidProjectError) return send(reply, 400, ErrorCodes.invalidProject);
  throw error;
}

/**
 * The organisation's routes (Phase 32 E) are inside `requireFinance` like every route here; the
 * check names their own rule as well (decision O6), so a change of `requireFinance` cannot open
 * them by accident.
 */
const requireOrg: preHandlerAsyncHookHandler = async (request, reply) => {
  if (!request.user || !canManageOrgFinance(request.user)) {
    return send(reply, 403, ErrorCodes.forbidden);
  }
};

/**
 * Documents and contracts (Phase 32 part B, spec §7), and the organisation's items, folders and
 * files (part E, spec 2026-10-18), registered by `routes.ts` inside `requireFinance`: every route
 * here already knows its caller is a finance admin. An item or folder of an unknown id answers
 * 404. Each write tells the finance room (`finance:changed`, kind `items`) after it commits: with
 * the client's id, or null for an item of the organisation, which every open finance screen (each
 * client's tab too, for the shares) refetches on.
 */
export const financeDocumentsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { db } = deps;
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  const allowUpload = createRateLimiter({ windowMs: 60_000, max: 60 });
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };
  const changed = (groupId: string | null) => emitFinanceChanged(app.io, groupId, 'items');
  /**
   * The path's client exists, or a 404 is sent (false). The admin group keeps no items, folders
   * or files of its own (Phase 34 part E): its Financie tab shows the organisation's, so its
   * routes answer `409 admin_group` and there is one store, not two.
   */
  const clientOf = async (groupId: string, reply: FastifyReply): Promise<boolean> => {
    const group = await getGroup(db, groupId);
    if (!group) {
      void notFound(reply);
      return false;
    }
    if (isAdminGroup(group)) {
      void send(reply, 409, ErrorCodes.adminGroup);
      return false;
    }
    return true;
  };

  /** A folder's page, or a flat list with a type filter or a search, of one owner. */
  const listOf = async (request: FastifyRequest, reply: FastifyReply, groupId: string | null) => {
    const query = FinanceItemsQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const { folder, type, q, after } = query.data;
    // A search or a type filter lists every folder flat; otherwise the open folder (the root).
    const flat = q !== undefined || type !== undefined;
    try {
      return await listItems(db, groupId === null ? { kind: 'org' } : { kind: 'group', groupId }, {
        folderId: flat ? undefined : (folder ?? null),
        type,
        q,
        after,
      });
    } catch (error) {
      return documentsError(reply, error);
    }
  };

  app.get<IdParams>('/groups/:id/finance/items', async (request, reply) => {
    if (!(await clientOf(request.params.id, reply))) return reply;
    return listOf(request, reply, request.params.id);
  });

  app.get<IdParams>('/groups/:id/finance/folders', async (request, reply) => {
    if (!(await clientOf(request.params.id, reply))) return reply;
    return listFolders(db, request.params.id);
  });

  app.post<IdParams>(
    '/groups/:id/finance/items',
    { preHandler: limitWrites },
    async (request, reply) => {
      const body = FinanceItemBodySchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const groupId = request.params.id;
      if (!(await clientOf(groupId, reply))) return reply;
      try {
        const item = await createItem(db, request.user!.id, groupId, body.data);
        changed(groupId);
        return reply.code(201).send(item);
      } catch (error) {
        return documentsError(reply, error);
      }
    },
  );

  // `?group=`: a client's tab reads the item as that client sees it (its own share only).
  app.get<IdParams>('/finance/items/:id', async (request, reply) => {
    const query = FinanceItemViewQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const { group } = query.data;
    try {
      return await getItem(
        db,
        request.params.id,
        group ? { kind: 'client', groupId: group } : { kind: 'finance' },
      );
    } catch (error) {
      return documentsError(reply, error);
    }
  });

  app.patch<IdParams>('/finance/items/:id', { preHandler: limitWrites }, async (request, reply) => {
    const patch = FinanceItemPatchSchema.safeParse(request.body);
    if (!patch.success) return invalid(reply);
    try {
      const item = await updateItem(deps, request.user!.id, request.params.id, patch.data);
      changed(item.groupId);
      return item;
    } catch (error) {
      return documentsError(reply, error);
    }
  });

  app.delete<IdParams>(
    '/finance/items/:id',
    { preHandler: limitWrites },
    async (request, reply) => {
      try {
        const { groupId } = await deleteItem(deps, request.params.id);
        changed(groupId);
        return reply.code(204).send();
      } catch (error) {
        return documentsError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/groups/:id/finance/folders',
    { preHandler: limitWrites },
    async (request, reply) => {
      const body = FinanceFolderBodySchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const groupId = request.params.id;
      if (!(await clientOf(groupId, reply))) return reply;
      try {
        const folder = await createFolder(db, request.user!.id, groupId, body.data);
        changed(groupId);
        return reply.code(201).send(folder);
      } catch (error) {
        return documentsError(reply, error);
      }
    },
  );

  app.patch<IdParams>(
    '/finance/folders/:id',
    { preHandler: limitWrites },
    async (request, reply) => {
      const patch = FinanceFolderPatchSchema.safeParse(request.body);
      if (!patch.success) return invalid(reply);
      try {
        const folder = await updateFolder(db, request.params.id, patch.data);
        changed(folder.groupId);
        return folder;
      } catch (error) {
        return documentsError(reply, error);
      }
    },
  );

  app.delete<IdParams>(
    '/finance/folders/:id',
    { preHandler: limitWrites },
    async (request, reply) => {
      try {
        const { groupId } = await deleteFolder(db, request.params.id);
        changed(groupId);
        return reply.code(204).send();
      } catch (error) {
        return documentsError(reply, error);
      }
    },
  );

  // Who a finance reminder may notify: the finance admins (the reminders' recipient picker).
  app.get('/finance/recipients', async (): Promise<FinancePerson[]> => listFinanceHolders(db));

  // The organisation (Phase 32 E): its items and folders, on `/finance` only.
  await app.register(async (org) => {
    org.addHook('preHandler', requireOrg);

    org.get('/finance/org/items', async (request, reply) => listOf(request, reply, null));

    org.get('/finance/org/folders', async () => listFolders(db, null));

    org.post('/finance/org/items', { preHandler: limitWrites }, async (request, reply) => {
      const body = FinanceOrgItemBodySchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      try {
        const item = await createOrgItem(db, request.user!.id, body.data);
        changed(null);
        return reply.code(201).send(item);
      } catch (error) {
        return documentsError(reply, error);
      }
    });

    org.post('/finance/org/folders', { preHandler: limitWrites }, async (request, reply) => {
      const body = FinanceFolderBodySchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      try {
        const folder = await createFolder(db, request.user!.id, null, body.data);
        changed(null);
        return reply.code(201).send(folder);
      } catch (error) {
        return documentsError(reply, error);
      }
    });

    // Who a salary may pay (decision E4): the active admins and the superadmin.
    org.get('/finance/payees', async (): Promise<FinancePerson[]> =>
      (await listAdmins(db))
        .filter((admin) => canBePayee({ role: admin.role, disabledAt: null }))
        .map((admin) => ({ id: admin.id, name: admin.name })),
    );
  });

  // The upload body is never buffered: the catch-all parser hands the raw stream to the handler.
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
    const receive = async (
      request: FastifyRequest,
      reply: FastifyReply,
      groupId: string | null,
    ) => {
      const actor = request.user!;
      if (!allowUpload(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
      const tooLarge = () =>
        reply.code(413).header('connection', 'close').send({ error: ErrorCodes.fileTooLarge });
      if (Number(request.headers['content-length']) > MAX_FILE_BYTES) return tooLarge();
      try {
        const info = await uploadFinanceFile(deps, {
          groupId,
          uploadedBy: actor.id,
          name: decodeFileNameHeader(request.headers['x-file-name'] as string | undefined),
          declaredType: request.headers['content-type'],
          body: request.raw,
        });
        return reply.code(201).send(info);
      } catch (error) {
        if (error instanceof FileTooLargeError) return tooLarge();
        throw error;
      }
    };
    upload.post<IdParams>('/groups/:id/finance/files', async (request, reply) => {
      if (!(await clientOf(request.params.id, reply))) return reply;
      return receive(request, reply, request.params.id);
    });
    upload.post('/finance/org/files', { preHandler: requireOrg }, async (request, reply) =>
      receive(request, reply, null),
    );
  });
};
