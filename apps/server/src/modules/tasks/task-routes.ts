import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import {
  ErrorCodes,
  TaskCreateSchema,
  TaskMoveSchema,
  TaskPatchSchema,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { emitMessageTasks } from '../chat/events.js';
import { messageTasksEvent } from '../chat/messages.js';
import { requireUser } from '../auth/session.js';
import { InvalidAttachmentError } from '../files/service.js';
import { getMembershipGroupId } from '../groups/service.js';
import { emitTask, emitTaskDeleted } from './events.js';
import { canDeleteTask, canUseBoard } from './policy.js';
import type { WriteGuard } from './routes.js';
import {
  createTask,
  deleteTask,
  getTask,
  getTaskRef,
  InvalidAssigneeError,
  moveTask,
  NotFoundError,
  TaskChangedError,
  toTaskDto,
  updateTask,
  ValidationError,
} from './task-service.js';

type IdParams = { Params: { id: string } };

export type TaskRoutesOptions = {
  deps: AppDeps;
  writeGuard: WriteGuard;
  /** True when the actor may open the board of `groupId` and the group exists. */
  canOpenGroup(actor: SessionUser, groupId: string): Promise<boolean>;
};

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });

/** 400 for a body that failed `TaskCreateSchema`/`TaskPatchSchema`: too many assignees has its own code. */
const invalidBody = (reply: FastifyReply, error: ZodError) => {
  const tooManyAssignees = error.issues.some(
    (issue) => issue.path[0] === 'assigneeIds' && issue.code === 'too_big',
  );
  return reply
    .code(400)
    .send({ error: tooManyAssignees ? ErrorCodes.invalidAssignee : ErrorCodes.validationFailed });
};

/** Maps the expected service errors of a task write; anything else is rethrown. */
const writeError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof NotFoundError) return notFound(reply);
  if (error instanceof InvalidAssigneeError) {
    return reply.code(400).send({ error: ErrorCodes.invalidAssignee });
  }
  if (error instanceof InvalidAttachmentError) {
    return reply.code(400).send({ error: ErrorCodes.invalidAttachment });
  }
  if (error instanceof ValidationError) {
    return reply.code(400).send({ error: ErrorCodes.validationFailed });
  }
  if (error instanceof TaskChangedError) {
    return reply.code(409).send({ error: ErrorCodes.taskChanged });
  }
  throw error;
};

/** Create, read, edit, move and delete tasks. Registered by `tasksRoutes`, which owns the write guard. */
export const taskRoutes: FastifyPluginAsync<TaskRoutesOptions> = async (
  app,
  { deps, writeGuard, canOpenGroup },
) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const person = (actor: SessionUser) => ({ id: actor.id, name: actor.name });
  /** Logs a failed post-commit file cleanup (no file names); the request still succeeds. */
  const logCleanupError = (request: FastifyRequest) => (error: unknown) =>
    request.log.error({ err: error }, 'could not delete the files of a task');

  /**
   * After a write to a task made from a message: pushes that message's current task links, so
   * open chats update its footer. A failure is logged; the write already succeeded.
   */
  const pushMessageTasks = async (request: FastifyRequest, messageId: string | null) => {
    if (messageId === null) return;
    try {
      const event = await messageTasksEvent(db, messageId);
      if (event) emitMessageTasks(app.io, event);
    } catch (error) {
      request.log.error({ err: error }, 'could not push the tasks of a message');
    }
  };

  /** The task's group and creator when the actor may use its board, else null (404). */
  const readableTask = async (actor: SessionUser, id: string) => {
    const ref = await getTaskRef(db, id);
    if (!ref || !canUseBoard(actor, ref.groupId, await getMembershipGroupId(db, actor.id))) {
      return null;
    }
    return ref;
  };

  app.post<IdParams>('/groups/:id/tasks', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = TaskCreateSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
    try {
      const task = await createTask(deps, actor, request.params.id, body.data);
      emitTask(app.io, toTaskDto(task), person(actor));
      return reply.code(201).send(task);
    } catch (error) {
      return writeError(reply, error);
    }
  });

  app.get<IdParams>('/tasks/:id', { preHandler: anyUser }, async (request, reply) => {
    if (!(await readableTask(request.user!, request.params.id))) return notFound(reply);
    const task = await getTask(db, request.params.id);
    return task ?? notFound(reply);
  });

  app.patch<IdParams>('/tasks/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = TaskPatchSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    // Anyone who may use the board edits any of its tasks.
    if (!(await readableTask(actor, request.params.id))) return notFound(reply);
    try {
      const task = await updateTask(deps, actor, request.params.id, body.data, {
        onFileCleanupError: logCleanupError(request),
      });
      emitTask(app.io, toTaskDto(task), person(actor));
      await pushMessageTasks(request, task.sourceMessageId);
      return task;
    } catch (error) {
      return writeError(reply, error);
    }
  });

  app.post<IdParams>('/tasks/:id/move', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = TaskMoveSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    // Anyone who may use the board moves any of its tasks.
    if (!(await readableTask(actor, request.params.id))) return notFound(reply);
    try {
      const { task, moved } = await moveTask(deps, actor, request.params.id, body.data);
      if (moved) {
        emitTask(app.io, task, person(actor));
        await pushMessageTasks(request, task.sourceMessageId);
      }
      return task;
    } catch (error) {
      return writeError(reply, error);
    }
  });

  app.delete<IdParams>('/tasks/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const ref = await readableTask(actor, request.params.id);
    if (!ref) return notFound(reply);
    if (!canDeleteTask(actor, ref)) return reply.code(403).send({ error: ErrorCodes.forbidden });
    try {
      const { groupId, sourceMessageId } = await deleteTask(deps, request.params.id, {
        onFileCleanupError: logCleanupError(request),
      });
      emitTaskDeleted(app.io, groupId, request.params.id);
      await pushMessageTasks(request, sourceMessageId);
      return reply.code(204).send();
    } catch (error) {
      return writeError(reply, error);
    }
  });
};
