import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, SetSubstitutionBodySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { auditActorOf } from '../audit/request-actor.js';
import { requireAdmin } from '../auth/session.js';
import { emitManagers } from './events.js';
import { listGroupManagers } from './managers.js';
import { canManageSubstitutions } from './policy.js';
import {
  AlreadySubstitutedError,
  endSubstitution,
  EndsInPastError,
  InvalidSubstituteError,
  startSubstitution,
  SubstitutedNotFoundError,
  SubstituteAwayError,
} from './substitutions.js';

type Params = { Params: { id: string } };

/**
 * Admin substitution ("Zastúpiť", 2026-10-19, ADR 0059) on the Administrators page:
 * `PUT /api/admins/:id/substitution` starts "the body's `substituteId` substitutes admin `:id`",
 * `DELETE` ends it (idempotent). Any admin, for themselves or a colleague.
 */
export const substitutionRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db } },
) => {
  const preHandler = requireAdmin(app.auth);
  const allow = createRateLimiter({ windowMs: 60_000, max: 30 });

  /** One `group:managers` per changed group, after the commit. */
  const emitChanged = async (groupIds: string[]) => {
    for (const groupId of new Set(groupIds)) {
      emitManagers(app.io, { groupId, managers: await listGroupManagers(db, groupId) });
    }
  };

  app.put<Params>('/admins/:id/substitution', { preHandler }, async (request, reply) => {
    if (!canManageSubstitutions(request.user!)) {
      return reply.code(403).send({ error: ErrorCodes.forbidden });
    }
    if (!allow(request.user!.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    const body = SetSubstitutionBodySchema.safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      const { substitution, changedGroupIds } = await startSubstitution(
        db,
        { substitutedId: request.params.id, ...body.data },
        auditActorOf(request),
      );
      await emitChanged(changedGroupIds);
      return reply.code(201).send(substitution);
    } catch (error) {
      if (error instanceof SubstitutedNotFoundError) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      if (error instanceof InvalidSubstituteError) {
        return reply.code(400).send({ error: ErrorCodes.invalidSubstitute });
      }
      if (error instanceof EndsInPastError) {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      if (error instanceof AlreadySubstitutedError) {
        return reply.code(409).send({ error: ErrorCodes.alreadySubstituted });
      }
      if (error instanceof SubstituteAwayError) {
        return reply.code(409).send({ error: ErrorCodes.substituteAway });
      }
      throw error;
    }
  });

  app.delete<Params>('/admins/:id/substitution', { preHandler }, async (request, reply) => {
    if (!canManageSubstitutions(request.user!)) {
      return reply.code(403).send({ error: ErrorCodes.forbidden });
    }
    if (!allow(request.user!.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    const { changedGroupIds } = await endSubstitution(db, request.params.id, auditActorOf(request));
    await emitChanged(changedGroupIds);
    return reply.code(204).send();
  });
};
