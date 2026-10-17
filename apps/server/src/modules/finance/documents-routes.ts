import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import {
  ErrorCodes,
  FinanceFolderBodySchema,
  FinanceFolderPatchSchema,
  FinanceItemBodySchema,
  FinanceItemPatchSchema,
  FinanceItemsQuerySchema,
  type FinancePerson,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { decodeFileNameHeader } from '../files/file-name.js';
import { FileTooLargeError, InvalidAttachmentError, MAX_FILE_BYTES } from '../files/service.js';
import { getGroup } from '../groups/service.js';
import { listFinanceHolders } from '../users/service.js';
import {
  createItem,
  deleteItem,
  getItem,
  InvalidCursorError,
  listItems,
  updateItem,
} from './documents.js';
import {
  FinanceChangedError,
  FinanceFolderCycleError,
  FinanceFolderLimitError,
  FinanceNotFoundError,
  FinanceValidationError,
} from './errors.js';
import { emitFinanceChanged } from './events.js';
import { uploadFinanceFile } from './files.js';
import { createFolder, deleteFolder, listFolders, updateFolder } from './folders.js';
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
  if (error instanceof FinanceChangedError) return send(reply, 409, ErrorCodes.financeChanged);
  if (error instanceof FinanceFolderCycleError) return send(reply, 400, ErrorCodes.invalidFolder);
  if (error instanceof FinanceFolderLimitError) return send(reply, 400, ErrorCodes.folderLimit);
  if (error instanceof InvalidAttachmentError) {
    return send(reply, 400, ErrorCodes.invalidAttachment);
  }
  if (error instanceof FinanceValidationError || error instanceof InvalidCursorError) {
    return invalid(reply);
  }
  throw error;
}

/**
 * Documents and contracts (Phase 32 part B, spec §7), registered by `routes.ts` inside
 * `requireFinance`: every route here already knows its caller is a finance admin. An item or
 * folder of an unknown id answers 404. Each write tells the finance room (`finance:changed`,
 * kind `items`) after it commits.
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
  const changed = (groupId: string) => emitFinanceChanged(app.io, groupId, 'items');
  /** The path's client exists (finance belongs to every client group). */
  const knownGroup = async (groupId: string) => (await getGroup(db, groupId)) !== null;

  app.get<IdParams>('/groups/:id/finance/items', async (request, reply) => {
    const query = FinanceItemsQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    if (!(await knownGroup(request.params.id))) return notFound(reply);
    const { folder, type, q, after } = query.data;
    // A search or a type filter lists every folder flat; otherwise the open folder (the root).
    const flat = q !== undefined || type !== undefined;
    try {
      return await listItems(
        db,
        { kind: 'group', groupId: request.params.id },
        { folderId: flat ? undefined : (folder ?? null), type, q, after },
      );
    } catch (error) {
      return documentsError(reply, error);
    }
  });

  app.get<IdParams>('/groups/:id/finance/folders', async (request, reply) => {
    if (!(await knownGroup(request.params.id))) return notFound(reply);
    return listFolders(db, request.params.id);
  });

  app.post<IdParams>(
    '/groups/:id/finance/items',
    { preHandler: limitWrites },
    async (request, reply) => {
      const body = FinanceItemBodySchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const groupId = request.params.id;
      if (!(await knownGroup(groupId))) return notFound(reply);
      try {
        const item = await createItem(db, request.user!.id, groupId, body.data);
        changed(groupId);
        return reply.code(201).send(item);
      } catch (error) {
        return documentsError(reply, error);
      }
    },
  );

  app.get<IdParams>('/finance/items/:id', async (request, reply) => {
    try {
      return await getItem(db, request.params.id);
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
      if (!(await knownGroup(groupId))) return notFound(reply);
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

  // The upload body is never buffered: the catch-all parser hands the raw stream to the handler.
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
    upload.post<IdParams>('/groups/:id/finance/files', async (request, reply) => {
      const actor = request.user!;
      const groupId = request.params.id;
      if (!(await knownGroup(groupId))) return notFound(reply);
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
    });
  });
};
