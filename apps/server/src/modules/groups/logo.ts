import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { StorageNotFoundError } from '../../infra/storage/storage.js';
import { requireUser } from '../auth/session.js';
import { sniffImageType, type ImageType } from '../files/sniff.js';
import { canManageGroups, canReadGroup } from './policy.js';
import { getGroup, getGroupByInviteToken, setLogoKey } from './service.js';
import { clientGroupIds } from './memberships.js';

const MAX_LOGO_BYTES = 512 * 1024;
const EXTENSIONS: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

type LogoDeps = Pick<AppDeps, 'db' | 'storage'>;

/** Deletes a storage file, ignoring one that is already gone. */
const dropFile = async (storage: LogoDeps['storage'], key: string | null) => {
  if (key) await storage.delete(key).catch(() => undefined);
};

/**
 * Stores `bytes` (already checked to be `type`) as the group's logo and deletes the previous
 * file. Shared by the in-app upload and the eGrant groups webhook.
 */
export async function replaceGroupLogo(
  { db, storage }: LogoDeps,
  groupId: string,
  bytes: Buffer,
  type: ImageType,
): Promise<void> {
  const key = `groups/${groupId}/logo-${randomBytes(8).toString('hex')}.${EXTENSIONS[type]}`;
  await storage.put(key, bytes, type);
  let previous: string | null;
  try {
    previous = await setLogoKey(db, groupId, key);
  } catch (error) {
    await dropFile(storage, key);
    throw error;
  }
  await dropFile(storage, previous);
}

/** Removes the group's logo and its file; false when it had none. */
export async function removeGroupLogo({ db, storage }: LogoDeps, groupId: string): Promise<boolean> {
  const previous = await setLogoKey(db, groupId, null);
  await dropFile(storage, previous);
  return previous !== null;
}

type IdParams = { Params: { id: string } };
type TokenParams = { Params: { token: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });

/** Logo routes: admin upload/delete, member read and the public invite-page logo. */
export const logoRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db, storage } },
) => {
  const anyUser = requireUser(app.auth);

  /** Streams the stored logo with cache headers; honours If-None-Match. */
  const sendLogo = async (request: FastifyRequest, reply: FastifyReply, key: string | null) => {
    if (!key) return notFound(reply);
    const etag = `"${key}"`;
    reply.header('cache-control', 'private, max-age=86400').header('etag', etag);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    try {
      const file = await storage.get(key);
      return reply.type(file.contentType).header('content-length', file.size).send(file.stream);
    } catch (error) {
      if (error instanceof StorageNotFoundError) return notFound(reply);
      throw error;
    }
  };

  // Upload lives in its own scope: the raw-body parser must not touch other routes. The
  // catch-all parser hands every content type to the handler, so a wrong type answers
  // 400 invalid_logo (not Fastify's 415). JSON has a built-in parser, so replace it too.
  await app.register(async (upload) => {
    upload.removeContentTypeParser('application/json');
    upload.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: MAX_LOGO_BYTES },
      (_req, body, done) => done(null, body),
    );
    upload.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: MAX_LOGO_BYTES },
      (_req, body, done) => done(null, body),
    );

    upload.put<IdParams>(
      '/groups/:id/logo',
      { preHandler: anyUser, bodyLimit: MAX_LOGO_BYTES },
      async (request, reply) => {
        if (!canManageGroups(request.user!)) return forbidden(reply);
        const { id } = request.params;
        if (!(await getGroup(db, id))) return notFound(reply);

        const body = request.body;
        const declared = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        const type = Buffer.isBuffer(body) ? sniffImageType(body) : null;
        if (!Buffer.isBuffer(body) || !type || type !== declared) {
          return reply.code(400).send({ error: ErrorCodes.invalidLogo });
        }

        await replaceGroupLogo({ db, storage }, id, body, type);
        return reply.code(204).send();
      },
    );
  });

  app.delete<IdParams>('/groups/:id/logo', { preHandler: anyUser }, async (request, reply) => {
    if (!canManageGroups(request.user!)) return forbidden(reply);
    const { id } = request.params;
    if (!(await getGroup(db, id))) return notFound(reply);
    await removeGroupLogo({ db, storage }, id);
    return reply.code(204).send();
  });

  app.get<IdParams>('/groups/:id/logo', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    return sendLogo(request, reply, (await getGroup(db, id))?.logoKey ?? null);
  });

  app.get<TokenParams>('/join/:token/logo', async (request, reply) =>
    sendLogo(
      request,
      reply,
      (await getGroupByInviteToken(db, request.params.token))?.logoKey ?? null,
    ),
  );
};
