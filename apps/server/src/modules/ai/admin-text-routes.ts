import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { adminGroupId } from '../groups/admin-group.js';
import { isAdmin } from '../users/policy.js';
import type { TextToolCore } from './text-routes.js';

/**
 * The AI text tools and voice input of fields that belong to no client group (the bulk email
 * builder, an admin's notes for Claude, a ticket form before its group is chosen): admins only,
 * the same policy as the admin group they run in. Registered by `textToolRoutes` with its core:
 * the same providers, prompts and per-user limits as the chat and the group routes. A client
 * and a ziadatel get 403; translate is never offered (the admin group has no eGrant URL).
 */
export const adminTextToolRoutes: FastifyPluginAsync<{
  deps: AppDeps;
  core: TextToolCore;
}> = async (app, { deps, core }) => {
  const anyUser = requireUser(app.auth);

  /** The admin group's id when the actor is an admin; otherwise the reply is sent and null. */
  async function adminGroup(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    if (!isAdmin(request.user!)) {
      reply.code(403).send({ error: ErrorCodes.forbidden });
      return null;
    }
    const id = await adminGroupId(deps.db);
    if (!id) reply.code(404).send({ error: ErrorCodes.notFound });
    return id;
  }

  app.get('/ai/admin/ai-tools', { preHandler: anyUser }, async (request, reply) => {
    const groupId = await adminGroup(request, reply);
    if (!groupId) return reply;
    return core.info(groupId, true);
  });

  app.post('/ai/admin/ai-text', { preHandler: anyUser }, async (request, reply) => {
    const groupId = await adminGroup(request, reply);
    if (!groupId) return reply;
    return core.rewrite(request, reply, groupId, { scope: 'admin' });
  });

  // Raw audio body, as the chat's route.
  await app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
    raw.post('/ai/admin/transcribe', { preHandler: anyUser }, async (request, reply) => {
      const groupId = await adminGroup(request, reply);
      if (!groupId) return reply;
      return core.transcribe(request, reply, { scope: 'admin' });
    });
  });
};
