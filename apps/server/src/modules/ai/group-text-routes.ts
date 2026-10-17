import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes, ID_RE } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { getGroup } from '../groups/service.js';
import type { TextToolCore } from './text-routes.js';

type IdParams = { Params: { id: string } };

/**
 * Phase 33 part P5 (spec decision 22): the AI text tools and voice input of description fields,
 * keyed by the group instead of a channel. Whoever reads the group (`canReadGroup`: admins and
 * its clients) uses all three; a ziadatel, an outsider and an unknown group get 404. Registered
 * by `textToolRoutes` with its core: the chat's providers, prompts and per-user limits, so the
 * cost cap stays one number.
 */
export const groupTextToolRoutes: FastifyPluginAsync<{
  deps: AppDeps;
  core: TextToolCore;
}> = async (app, { deps, core }) => {
  const anyUser = requireUser(app.auth);

  /** The group's id when the actor reads it; otherwise 404 (missing and unreadable look the same). */
  async function readableGroup(
    request: FastifyRequest<IdParams>,
    reply: FastifyReply,
  ): Promise<string | null> {
    const id = request.params.id;
    const readable =
      ID_RE.test(id) &&
      (await getGroup(deps.db, id)) !== null &&
      (await core.readsGroup(request.user!, id));
    if (readable) return id;
    reply.code(404).send({ error: ErrorCodes.notFound });
    return null;
  }

  app.get<IdParams>('/groups/:id/ai-tools', { preHandler: anyUser }, async (request, reply) => {
    const groupId = await readableGroup(request, reply);
    if (!groupId) return reply;
    return core.info(groupId, true);
  });

  app.post<IdParams>('/groups/:id/ai-text', { preHandler: anyUser }, async (request, reply) => {
    const groupId = await readableGroup(request, reply);
    if (!groupId) return reply;
    return core.rewrite(request, reply, groupId, { groupId });
  });

  // Raw audio body, as the chat's route.
  await app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
    raw.post<IdParams>(
      '/groups/:id/transcribe',
      { preHandler: anyUser },
      async (request, reply) => {
        const groupId = await readableGroup(request, reply);
        if (!groupId) return reply;
        return core.transcribe(request, reply, { groupId });
      },
    );
  });
};
