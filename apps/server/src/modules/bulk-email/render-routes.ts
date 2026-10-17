import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { BULK_LIMITS, BulkCampaignDraftSchema, ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { StorageNotFoundError } from '../../infra/storage/storage.js';
import { requireAdmin } from '../auth/session.js';
import { getUserById } from '../users/service.js';
import {
  ImageTooLargeError,
  UnsupportedImageError,
  getImage,
  imageSizes,
  saveImage,
} from './images.js';
import { imageIdsOf } from './message.js';
import { renderCampaign } from './render.js';
import { getCampaign } from './service.js';

/** `POST …/preview`: the draft as the editor holds it now. */
const PreviewSchema = BulkCampaignDraftSchema.pick({
  subject: true,
  preheader: true,
  blocks: true,
  phoneBlocks: true,
});
/** Matches the save route's limit (spec §9; two versions since Phase 30). */
const PREVIEW_BODY_LIMIT = 600_000;
/** The preview's unsubscribe link goes nowhere: it is never a real token. */
const PREVIEW_UNSUBSCRIBE_HREF = '#';

type IdParams = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const tooLarge = (reply: FastifyReply) =>
  reply.code(413).header('connection', 'close').send({ error: ErrorCodes.fileTooLarge });

/**
 * Bulk email images and preview (Phase 23.3, spec §3). Admin only, except `GET /images/:id`,
 * which is public: mail apps load it without a session, so the random id is the only secret,
 * and the route reads only `bulk_images` rows by id, never a storage key from the request.
 */
export const bulkEmailRenderRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { db, storage, config } = deps;
  const admin = requireAdmin(app.auth);
  const allowUpload = createRateLimiter({ windowMs: 60_000, max: 30 });

  // The upload body is never parsed: every content type hands the raw stream to the handler,
  // which reads at most BULK_LIMITS.imageBytes and sniffs the type from the bytes.
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    upload.post('/bulk-email/images', { preHandler: admin }, async (request, reply) => {
      if (!allowUpload(request.user!.id)) {
        return reply.code(429).send({ error: ErrorCodes.rateLimited });
      }
      if (Number(request.headers['content-length']) > BULK_LIMITS.imageBytes) {
        return tooLarge(reply);
      }
      try {
        const saved = await saveImage(deps, request.user!, request.raw);
        return reply.code(201).send(saved);
      } catch (error) {
        if (error instanceof ImageTooLargeError) return tooLarge(reply);
        if (error instanceof UnsupportedImageError) {
          return reply.code(415).send({ error: ErrorCodes.unsupportedType });
        }
        throw error;
      }
    });
  });

  app.get<IdParams>('/bulk-email/images/:id', async (request, reply) => {
    const image = await getImage(db, request.params.id);
    if (!image) return notFound(reply);
    try {
      const stored = await storage.get(image.storageKey);
      return reply
        .headers({
          'content-type': image.mime,
          'content-length': String(stored.size),
          'content-disposition': 'inline',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
          // Webmail shows the image on its own origin.
          'cross-origin-resource-policy': 'cross-origin',
          'cache-control': 'public, max-age=31536000, immutable',
        })
        .send(stored.stream);
    } catch (error) {
      if (error instanceof StorageNotFoundError) return notFound(reply);
      throw error;
    }
  });

  app.post<IdParams>(
    '/bulk-email/campaigns/:id/preview',
    { preHandler: admin, bodyLimit: PREVIEW_BODY_LIMIT },
    async (request, reply) => {
      const draft = PreviewSchema.safeParse(request.body);
      if (!draft.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
      if (!(await getCampaign(db, request.params.id))) return notFound(reply);

      const actor = request.user!;
      const me = await getUserById(db, actor.id);
      const imageIds = imageIdsOf(draft.data);
      const { html } = renderCampaign({
        ...draft.data,
        phoneBlocks: draft.data.phoneBlocks ?? null,
        recipient: { name: me?.name ?? actor.name, language: me?.language ?? 'sk' },
        unsubscribeHref: PREVIEW_UNSUBSCRIBE_HREF,
        publicUrl: config.publicUrl,
        imageSizes: await imageSizes(db, imageIds),
      });
      return { html };
    },
  );
};
