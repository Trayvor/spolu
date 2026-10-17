import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { StorageNotFoundError } from '../../infra/storage/storage.js';
import { requireUser } from '../auth/session.js';
import { canReadGroup } from '../groups/policy.js';
import { getGroup } from '../groups/service.js';
import { decodeFileNameHeader } from './file-name.js';
import { canReadFile, canSetPreview } from './policy.js';
import {
  FileTooLargeError,
  MAX_FILE_BYTES,
  createFile,
  getFile,
  setFilePreview,
} from './service.js';
import { IMAGE_TYPES, sniffImageType } from './sniff.js';
import { clientGroupIds } from '../groups/memberships.js';
import { readableByRule } from './read-rules.js';

const MAX_PREVIEW_BYTES = 300 * 1024;
const MAX_PREVIEW_SIDE = 20_000;
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';

type IdParams = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const tooLarge = (reply: FastifyReply) =>
  reply.code(413).header('connection', 'close').send({ error: ErrorCodes.fileTooLarge });

/** `filename*` value: encodeURIComponent plus the characters it leaves that RFC 5987 does not allow. */
function encodeRfc5987(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A positive integer header value in 1..MAX_PREVIEW_SIDE, else null. */
function parseSide(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_PREVIEW_SIDE ? n : null;
}

/**
 * One byte range of an object of `size` bytes from a `Range` header; null to send it whole (no
 * header, several ranges, another unit, a malformed value).
 */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === '' && to === '') return null;
  let start: number;
  let end: number;
  if (from === '') {
    const suffix = Number(to);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
    if (to !== '' && Number(to) < start) return null;
  }
  if (start >= size || size === 0) return 'unsatisfiable';
  return { start, end };
}

/** Files API: streamed upload, preview upload and cached downloads. */
export const filesRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, storage } = deps;
  const anyUser = requireUser(app.auth);
  const allowUpload = createRateLimiter({ windowMs: 60_000, max: 60 });

  /** The file when the caller may read it, else null (the route answers 404). */
  const readableFile = async (request: FastifyRequest, id: string) => {
    const actor = request.user!;
    const file = await getFile(db, id);
    if (!file) return null;
    if (canReadFile(actor, file, await clientGroupIds(db, actor.id))) return file;
    return (await readableByRule(db, actor, file)) ? file : null;
  };

  /**
   * Sends a stored object. A single `Range` request (`bytes=a-b`, `a-`, `-n`) answers 206 with
   * that part (Safari plays and seeks audio only so, Phase 30); an unsatisfiable one 416; several
   * ranges or a malformed header get the whole object.
   */
  const sendStored = async (
    reply: FastifyReply,
    key: string,
    headers: Record<string, string>,
    rangeHeader?: string,
  ) => {
    try {
      const stored = await storage.get(key);
      const base = {
        ...headers,
        'x-content-type-options': 'nosniff',
        'cache-control': IMMUTABLE_CACHE,
        'accept-ranges': 'bytes',
      };
      const range = parseRange(rangeHeader, stored.size);
      if (range === 'unsatisfiable') {
        stored.stream.destroy();
        return reply
          .code(416)
          .headers({ ...base, 'content-range': `bytes */${stored.size}` })
          .send();
      }
      if (range) {
        stored.stream.destroy();
        const part = await storage.get(key, range);
        return reply
          .code(206)
          .headers({
            ...base,
            'content-range': `bytes ${range.start}-${range.end}/${stored.size}`,
            'content-length': String(range.end - range.start + 1),
          })
          .send(part.stream);
      }
      return reply.headers({ ...base, 'content-length': String(stored.size) }).send(stored.stream);
    } catch (error) {
      if (error instanceof StorageNotFoundError) return notFound(reply);
      throw error;
    }
  };

  // The upload body is never buffered: the catch-all parser hands the raw stream to the handler.
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    upload.post<IdParams>('/groups/:id/files', { preHandler: anyUser }, async (request, reply) => {
      const actor = request.user!;
      const { id: groupId } = request.params;
      if (!canReadGroup(actor, groupId, await clientGroupIds(db, actor.id))) {
        return notFound(reply);
      }
      if (!(await getGroup(db, groupId))) return notFound(reply);
      if (!allowUpload(actor.id)) {
        return reply.code(429).send({ error: ErrorCodes.rateLimited });
      }
      if (Number(request.headers['content-length']) > MAX_FILE_BYTES) return tooLarge(reply);

      try {
        const info = await createFile(deps, {
          groupId,
          uploadedBy: actor.id,
          name: decodeFileNameHeader(request.headers['x-file-name'] as string | undefined),
          declaredType: request.headers['content-type'],
          body: request.raw,
        });
        return reply.code(201).send(info);
      } catch (error) {
        if (error instanceof FileTooLargeError) return tooLarge(reply);
        throw error;
      }
    });
  });

  // Preview bodies are small and buffered; every content type goes to the handler.
  await app.register(async (previews) => {
    for (const type of ['application/json', '*']) {
      if (type !== '*') previews.removeContentTypeParser(type);
      previews.addContentTypeParser(
        type,
        { parseAs: 'buffer', bodyLimit: MAX_PREVIEW_BYTES },
        (_req, body, done) => done(null, body),
      );
    }

    previews.put<IdParams>(
      '/files/:id/preview',
      { preHandler: anyUser, bodyLimit: MAX_PREVIEW_BYTES },
      async (request, reply) => {
        // The uploader sets the preview of their own new file even when no group rule lets them
        // read it yet (a ziadatel's upload to a ticket chat, Phase 21); others need to read it.
        const file = await getFile(db, request.params.id);
        if (!file) return notFound(reply);
        if (!canSetPreview(request.user!, file)) {
          if (!(await readableFile(request, file.id))) return notFound(reply);
          return reply.code(403).send({ error: ErrorCodes.forbidden });
        }

        const body = request.body;
        const width = parseSide(request.headers['x-image-width']);
        const height = parseSide(request.headers['x-image-height']);
        if (
          file.attachedAt !== null ||
          file.previewKey !== null ||
          !(IMAGE_TYPES as readonly string[]).includes(file.mime) ||
          !Buffer.isBuffer(body) ||
          sniffImageType(body) !== 'image/webp' ||
          width === null ||
          height === null
        ) {
          return reply.code(400).send({ error: ErrorCodes.invalidPreview });
        }

        if (!(await setFilePreview(deps, file, { body, width, height }))) {
          return reply.code(400).send({ error: ErrorCodes.invalidPreview });
        }
        return reply.code(204).send();
      },
    );
  });

  app.get<IdParams>('/files/:id', { preHandler: anyUser }, async (request, reply) => {
    const file = await readableFile(request, request.params.id);
    if (!file) return notFound(reply);
    const inline = (IMAGE_TYPES as readonly string[]).includes(file.mime);
    return sendStored(
      reply,
      file.storageKey,
      {
        'content-type': file.mime,
        'content-disposition': inline
          ? 'inline'
          : `attachment; filename*=UTF-8''${encodeRfc5987(file.name)}`,
      },
      request.headers.range,
    );
  });

  app.get<IdParams>('/files/:id/preview', { preHandler: anyUser }, async (request, reply) => {
    const file = await readableFile(request, request.params.id);
    if (!file?.previewKey) return notFound(reply);
    return sendStored(reply, file.previewKey, {
      'content-type': 'image/webp',
      'content-disposition': 'inline',
    });
  });
};
