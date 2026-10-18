import type { FastifyPluginAsync } from 'fastify';
import { AuditQuerySchema, ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin } from '../auth/session.js';
import { InvalidAuditFilterError, listAudit } from './list.js';
import { canReadAudit } from './policy.js';

/**
 * The audit log (spec §6): `GET /audit`, admins only (`requireAdmin`, then `canReadAudit`);
 * finance rows only for the finance right, filtered in SQL. Nothing writes through HTTP: rows
 * are written by `recordAudit` inside each module's own transaction.
 */
export const auditRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const admin = requireAdmin(app.auth);
  const allow = createRateLimiter({ windowMs: 60_000, max: 60 });

  app.get('/audit', { preHandler: admin }, async (request, reply) => {
    const actor = request.user!;
    if (!canReadAudit(actor)) return reply.code(403).send({ error: ErrorCodes.forbidden });
    if (!allow(actor.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    const query = AuditQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: ErrorCodes.invalidFilter });
    try {
      return await listAudit(db, actor, query.data);
    } catch (error) {
      if (error instanceof InvalidAuditFilterError) {
        return reply.code(400).send({ error: ErrorCodes.invalidFilter });
      }
      throw error;
    }
  });
};
