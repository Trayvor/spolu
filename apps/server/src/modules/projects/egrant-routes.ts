import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import {
  EGRANT_PROJECT_LIMITS,
  EgrantProjectBodySchema,
  EgrantProjectIdSchema,
  EgrantReviewBodySchema,
  ErrorCodes,
  intakeFieldNames,
  ProjectMergeBodySchema,
  type EgrantProjectResponse,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { egrantWebhookKey } from '../../infra/config/config.js';
import { bearerKeyMatches } from '../../infra/http/bearer-key.js';
import { egrantSignature } from '../../infra/http/egrant-signature.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { egrantHostOf } from '../groups/egrant-url.js';
import { clientGroupIds } from '../groups/memberships.js';
import { findGroupByEgrantUrl } from '../groups/service.js';
import { emitTicketRefresh } from '../tickets/events.js';
import {
  ChangeOutdatedError,
  changeKinds,
  listEgrantChanges,
  receiveProjectDelivery,
  reviewEgrantChanges,
  storeInboxDelivery,
} from './egrant-delivery.js';
import { ProjectNameTakenError, ProjectNotFoundError, ProjectValidationError } from './errors.js';
import { emitProjectChanged } from './events.js';
import { mergeProjects } from './merge.js';
import { canEditProjects, canMergeOrDeleteProject, canReadProjects } from './policy.js';
import { projectGroupId } from './service.js';

type IdParams = { Params: { id: string } };
type EgrantParams = { Params: { project_id: string } };
type GroupRule = (actor: SessionUser, groupId: string, actorGroupIds: readonly string[]) => boolean;

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const fieldsFailed = (reply: FastifyReply, fields: string[]) =>
  reply.code(400).send({ error: ErrorCodes.validationFailed, fields });

function reviewError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ProjectNotFoundError) return notFound(reply);
  if (error instanceof ChangeOutdatedError) return send(reply, 409, ErrorCodes.changeOutdated);
  if (error instanceof ProjectNameTakenError) {
    return reply.code(409).send({ error: ErrorCodes.projectNameTaken, name: error.otherName });
  }
  if (error instanceof ProjectValidationError) return send(reply, 400, ErrorCodes.validationFailed);
  throw error;
}

/**
 * eGrant projects (Phase 33 part P3, spec §5): the project endpoint eGrant calls with its key, the review of pending changes and the merge. The user routes check the module's policy for
 * the project's client first; a caller who cannot read it gets 404.
 */
export const egrantProjectRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const anyUser = requireUser(app.auth);
  const allowDelivery = createRateLimiter({ windowMs: 60_000, max: 120 });
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };

  // ---- The project endpoint: the key is the credential, no session --------------------------
  // `EGRANT_PROJECTS_API_KEY`, else the ticket intake's key (`egrantWebhookKey`).
  const key = egrantWebhookKey(config, 'projects');
  // As every eGrant webhook, before the body is read: 503, then the limit (it counts every
  // call, so wrong keys are limited too), then the key.
  const deliveryGate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!key) return send(reply, 503, ErrorCodes.intakeDisabled);
    if (!allowDelivery(request.ip)) return send(reply, 429, ErrorCodes.rateLimited);
    if (!bearerKeyMatches(request.headers.authorization, key)) {
      return send(reply, 401, ErrorCodes.unauthorized);
    }
  };

  app.put<EgrantParams>(
    '/egrant/projects/:project_id',
    {
      onRequest: deliveryGate,
      bodyLimit: EGRANT_PROJECT_LIMITS.bodyBytes,
      // Optional HMAC signature (EGRANT_PROJECTS_SIGNING_SECRET, ADR 0042), after the key.
      ...egrantSignature(config, 'projects'),
    },
    async (request, reply) => {
      const id = EgrantProjectIdSchema.safeParse(request.params.project_id);
      const body = EgrantProjectBodySchema.safeParse(request.body);
      const fields = [
        ...(id.success ? [] : ['project_id']),
        ...(body.success ? [] : intakeFieldNames(body.error.issues)),
      ];
      if (!id.success || !body.success) return fieldsFailed(reply, fields);
      const egrantId = id.data;
      const host = egrantHostOf(body.data.instance_url);
      if (host === null) return fieldsFailed(reply, ['instance_url']);
      const group = await findGroupByEgrantUrl(db, body.data.instance_url);
      if (!group || group.kind !== 'client') {
        await storeInboxDelivery(db, host, egrantId, body.data);
        const stored: EgrantProjectResponse = { project_id: egrantId, state: 'stored' };
        return reply.code(202).send(stored);
      }
      // A deactivated client takes no projects (as tickets and managers): nothing is stored.
      if (group.deactivatedAt) {
        request.log.info({ groupId: group.id }, 'egrant project: deactivated client');
        return send(reply, 409, ErrorCodes.groupInactive);
      }
      const result = await db.transaction((tx) =>
        receiveProjectDelivery(tx, group.id, egrantId, body.data),
      );
      for (const field of result.skipped) {
        // Never the event's text: only where it was and why.
        request.log.info({ host, projectId: egrantId, field }, 'egrant event skipped');
      }
      if (result.state !== 'stale' && result.state !== 'unchanged') {
        emitProjectChanged(
          app.io,
          group.id,
          result.projectId,
          result.state === 'created' ? 'project' : 'egrant',
        );
      }
      for (const ticketId of result.linkedTicketIds) await emitTicketRefresh(app.io, db, ticketId);
      const answer: EgrantProjectResponse =
        result.state === 'stale'
          ? { project_id: egrantId, state: 'stale' }
          : result.state === 'created'
            ? { project_id: egrantId, state: 'created', skipped: result.skipped }
            : {
                project_id: egrantId,
                state: result.state,
                pending: result.pending,
                skipped: result.skipped,
              };
      return reply.code(result.state === 'created' ? 201 : 200).send(answer);
    },
  );

  // ---- Review and merge (people) ----------------------------------------------------------------
  /** The project's client when the caller reads it and `rule` passes there; else null (404). */
  const projectFor = async (actor: SessionUser, id: string, rule: GroupRule) => {
    const groupId = await projectGroupId(db, id);
    if (groupId === null) return null;
    const ids = await clientGroupIds(db, actor.id);
    return canReadProjects(actor, groupId, ids) && rule(actor, groupId, ids) ? groupId : null;
  };

  app.get<IdParams>(
    '/projects/:id/egrant-changes',
    { preHandler: anyUser },
    async (request, reply) => {
      if ((await projectFor(request.user!, request.params.id, canEditProjects)) === null) {
        return notFound(reply);
      }
      try {
        return await listEgrantChanges(db, request.params.id);
      } catch (error) {
        return reviewError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/projects/:id/egrant-changes',
    { preHandler: [anyUser, limitWrites] },
    async (request, reply) => {
      const actor = request.user!;
      const projectId = request.params.id;
      const groupId = await projectFor(actor, projectId, canEditProjects);
      if (groupId === null) return notFound(reply);
      const body = EgrantReviewBodySchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      // Accepting a removal deletes the event: the merge-or-delete rule (decision 8a).
      const kinds = await changeKinds(db, projectId, body.data.accept);
      if (kinds.includes('event_remove')) {
        const ids = await clientGroupIds(db, actor.id);
        if (!canMergeOrDeleteProject(actor, groupId, ids)) {
          return send(reply, 403, ErrorCodes.forbidden);
        }
      }
      try {
        const project = await reviewEgrantChanges(deps, projectId, body.data);
        emitProjectChanged(app.io, groupId, projectId, 'egrant');
        return project;
      } catch (error) {
        return reviewError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/projects/:id/merge',
    { preHandler: [anyUser, limitWrites] },
    async (request, reply) => {
      const actor = request.user!;
      const groupId = await projectFor(actor, request.params.id, canMergeOrDeleteProject);
      if (groupId === null) return notFound(reply);
      const body = ProjectMergeBodySchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      try {
        const project = await mergeProjects(deps, request.params.id, body.data.into);
        emitProjectChanged(app.io, groupId, request.params.id, 'project');
        emitProjectChanged(app.io, groupId, project.id, 'project');
        return project;
      } catch (error) {
        return reviewError(reply, error);
      }
    },
  );
};
