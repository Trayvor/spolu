import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import {
  ErrorCodes,
  EventCreateBodySchema,
  EventPatchBodySchema,
  ProjectCreateBodySchema,
  ProjectListQuerySchema,
  ProjectPatchBodySchema,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { InvalidAttachmentError } from '../files/service.js';
import { clientGroupIds } from '../groups/memberships.js';
import { getGroup } from '../groups/service.js';
import { InvalidKnowledgeLinkError } from '../knowledge/links.js';
import {
  ProjectChangedError,
  ProjectNameTakenError,
  ProjectNotFoundError,
  ProjectValidationError,
} from './errors.js';
import { emitProjectChanged } from './events.js';
import {
  canArchiveProject,
  canEditProjects,
  canMergeOrDeleteProject,
  canReadProjects,
} from './policy.js';
import { listPickerProjects } from './refs.js';
import {
  createEvent,
  createProject,
  deleteEvent,
  deleteProject,
  eventOwner,
  getEvent,
  getProject,
  InvalidProjectCursorError,
  listEventPicker,
  listProjects,
  projectGroupId,
  removeAlias,
  setProjectStatus,
  updateEvent,
  updateProject,
} from './service.js';

type IdParams = { Params: { id: string } };
type AliasParams = { Params: { id: string; key: string } };
type GroupRule = (actor: SessionUser, groupId: string, actorGroupIds: readonly string[]) => boolean;

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

/** Maps the expected errors of the service; anything else is rethrown (500). */
function projectError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ProjectNotFoundError) return notFound(reply);
  if (error instanceof ProjectChangedError) return send(reply, 409, ErrorCodes.projectChanged);
  if (error instanceof ProjectNameTakenError) {
    return reply.code(409).send({ error: ErrorCodes.projectNameTaken, name: error.otherName });
  }
  if (error instanceof InvalidAttachmentError) {
    return send(reply, 400, ErrorCodes.invalidAttachment);
  }
  if (error instanceof InvalidKnowledgeLinkError) {
    return send(reply, 400, ErrorCodes.invalidKnowledgeItem);
  }
  if (error instanceof ProjectValidationError || error instanceof InvalidProjectCursorError) {
    return invalid(reply);
  }
  throw error;
}

/**
 * Projects and events of a client (Phase 33 part P1, spec §7.6). Every route checks the module's
 * policy for the project's client first: a caller who cannot read the group (a žiadateľ, another
 * client) gets 404, as for an unknown id. Writes tell the group room `project:changed` after
 * they commit. The merge (`POST /projects/:id/merge`), the eGrant endpoint, the timeline and the
 * overview cards are registered by parts P3 and P4 in their own files.
 */
export const projectsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });
  const limitWrites: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
  };
  const writeGuard = [anyUser, limitWrites];

  /** The caller reads the client and `rule` passes there. */
  const passes = async (actor: SessionUser, groupId: string, rule: GroupRule) => {
    const ids = await clientGroupIds(db, actor.id);
    return canReadProjects(actor, groupId, ids) && rule(actor, groupId, ids);
  };
  /** The group exists and `rule` passes; else 404. */
  const groupFor = async (actor: SessionUser, groupId: string, rule: GroupRule) =>
    (await passes(actor, groupId, rule)) && (await getGroup(db, groupId)) !== null;
  /** The project's client when `rule` passes there; else null (404). */
  const projectFor = async (actor: SessionUser, id: string, rule: GroupRule = canReadProjects) => {
    const groupId = await projectGroupId(db, id);
    return groupId !== null && (await passes(actor, groupId, rule)) ? groupId : null;
  };
  /** The event's client and project when `rule` passes there; else null (404). */
  const eventFor = async (actor: SessionUser, id: string, rule: GroupRule = canReadProjects) => {
    const owner = await eventOwner(db, id);
    return owner !== null && (await passes(actor, owner.groupId, rule)) ? owner : null;
  };
  const changed = (groupId: string, projectId: string, kind: 'project' | 'event') =>
    emitProjectChanged(app.io, groupId, projectId, kind);

  app.get<IdParams>('/groups/:id/projects', { preHandler: anyUser }, async (request, reply) => {
    const query = ProjectListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    if (!(await groupFor(request.user!, request.params.id, canReadProjects))) {
      return notFound(reply);
    }
    try {
      return await listProjects(db, request.params.id, query.data);
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.get<IdParams>(
    '/groups/:id/projects/picker',
    { preHandler: anyUser },
    async (request, reply) => {
      if (!(await groupFor(request.user!, request.params.id, canReadProjects))) {
        return notFound(reply);
      }
      return listPickerProjects(db, request.params.id);
    },
  );

  app.post<IdParams>('/groups/:id/projects', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const groupId = request.params.id;
    if (!(await groupFor(actor, groupId, canEditProjects))) return notFound(reply);
    const body = ProjectCreateBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    try {
      const project = await createProject(db, actor.id, groupId, body.data, {
        actor,
        jobs: deps.jobs,
      });
      changed(groupId, project.id, 'project');
      return reply.code(201).send(project);
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.get<IdParams>('/projects/:id', { preHandler: anyUser }, async (request, reply) => {
    if ((await projectFor(request.user!, request.params.id)) === null) return notFound(reply);
    try {
      return await getProject(db, request.params.id);
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.patch<IdParams>('/projects/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const groupId = await projectFor(actor, request.params.id, canEditProjects);
    if (groupId === null) return notFound(reply);
    const patch = ProjectPatchBodySchema.safeParse(request.body);
    if (!patch.success) return invalid(reply);
    try {
      const project = await updateProject(deps, actor.id, request.params.id, patch.data, {
        actor,
        jobs: deps.jobs,
      });
      changed(groupId, project.id, 'project');
      return project;
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.delete<IdParams>('/projects/:id', { preHandler: writeGuard }, async (request, reply) => {
    const groupId = await projectFor(request.user!, request.params.id, canMergeOrDeleteProject);
    if (groupId === null) return notFound(reply);
    try {
      await deleteProject(deps, request.params.id);
      changed(groupId, request.params.id, 'project');
      return reply.code(204).send();
    } catch (error) {
      return projectError(reply, error);
    }
  });

  for (const [path, status] of [
    ['archive', 'archived'],
    ['restore', 'active'],
  ] as const) {
    app.post<IdParams>(
      `/projects/:id/${path}`,
      { preHandler: writeGuard },
      async (request, reply) => {
        const groupId = await projectFor(request.user!, request.params.id, canArchiveProject);
        if (groupId === null) return notFound(reply);
        try {
          const project = await setProjectStatus(db, request.params.id, status);
          changed(groupId, project.id, 'project');
          return project;
        } catch (error) {
          return projectError(reply, error);
        }
      },
    );
  }

  app.delete<AliasParams>(
    '/projects/:id/aliases/:key',
    { preHandler: writeGuard },
    async (request, reply) => {
      const { id, key } = request.params;
      const groupId = await projectFor(request.user!, id, canMergeOrDeleteProject);
      if (groupId === null) return notFound(reply);
      try {
        await removeAlias(db, id, key);
        changed(groupId, id, 'project');
        return await getProject(db, id);
      } catch (error) {
        return projectError(reply, error);
      }
    },
  );

  app.get<IdParams>(
    '/projects/:id/events/picker',
    { preHandler: anyUser },
    async (request, reply) => {
      if ((await projectFor(request.user!, request.params.id)) === null) return notFound(reply);
      return listEventPicker(db, request.params.id);
    },
  );

  app.post<IdParams>('/projects/:id/events', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const groupId = await projectFor(actor, request.params.id, canEditProjects);
    if (groupId === null) return notFound(reply);
    const body = EventCreateBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    try {
      const event = await createEvent(db, actor.id, request.params.id, body.data);
      changed(groupId, event.projectId, 'event');
      return reply.code(201).send(event);
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.get<IdParams>('/project-events/:id', { preHandler: anyUser }, async (request, reply) => {
    if ((await eventFor(request.user!, request.params.id)) === null) return notFound(reply);
    try {
      return await getEvent(db, request.params.id);
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.patch<IdParams>('/project-events/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const owner = await eventFor(actor, request.params.id, canEditProjects);
    if (owner === null) return notFound(reply);
    const patch = EventPatchBodySchema.safeParse(request.body);
    if (!patch.success) return invalid(reply);
    try {
      const event = await updateEvent(deps, actor.id, request.params.id, patch.data);
      changed(owner.groupId, owner.projectId, 'event');
      return event;
    } catch (error) {
      return projectError(reply, error);
    }
  });

  app.delete<IdParams>(
    '/project-events/:id',
    { preHandler: writeGuard },
    async (request, reply) => {
      const owner = await eventFor(request.user!, request.params.id, canMergeOrDeleteProject);
      if (owner === null) return notFound(reply);
      try {
        await deleteEvent(deps, request.params.id);
        changed(owner.groupId, owner.projectId, 'event');
        return reply.code(204).send();
      } catch (error) {
        return projectError(reply, error);
      }
    },
  );
};
