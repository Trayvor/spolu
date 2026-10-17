import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import {
  ErrorCodes,
  TaskCreateSchema,
  TaskMoveSchema,
  TaskPatchSchema,
  TasksFromMessageSchema,
  TasksFromTicketSchema,
  type SessionUser,
  type TasksFromMessageResult,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { emitMessageTasks } from '../chat/events.js';
import { findReadableMessage, getMessageFiles, messageTasksEvent } from '../chat/messages.js';
import { requireUser } from '../auth/session.js';
import { InvalidAttachmentError } from '../files/service.js';
import { emitTask, emitTaskDeleted } from './events.js';
import { canDeleteTask, canUseBoard } from './policy.js';
import type { WriteGuard } from './routes.js';
import { announceTimeChange, type TimeChange } from '../finance/task-time.js';
import {
  createTaskTimed,
  createTasksFromSource,
  deleteTask,
  getTask,
  getTaskRef,
  InvalidAssigneeError,
  moveTask,
  NotFoundError,
  TaskChangedError,
  toTaskDto,
  updateTaskTimed,
  ValidationError,
} from './task-service.js';
import { clientGroupIds } from '../groups/memberships.js';
import { emitMeetingTasks } from '../knowledge/events.js';
import { emitSeen, markTaskSeen } from '../notifications/unseen.js';
import { emitTicket, emitTicketRefresh } from '../tickets/events.js';
import { runTicketChange } from '../tickets/hooks.js';
import { actorReadsTicket, attachmentIds, getTicketRow } from '../tickets/service.js';

type IdParams = { Params: { id: string } };

export type TaskRoutesOptions = {
  deps: AppDeps;
  writeGuard: WriteGuard;
  /** True when the actor may open the board of `groupId` and the group exists. */
  canOpenGroup(actor: SessionUser, groupId: string): Promise<boolean>;
};

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });

/**
 * 400 for a body that failed a task schema: too many assignees and a link that is not an http(s)
 * URL (on the task, or on a card made from a message) have their own codes.
 */
const invalidBody = (reply: FastifyReply, error: ZodError) => {
  const tooManyAssignees = error.issues.some(
    (issue) => issue.path.at(-1) === 'assigneeIds' && issue.code === 'too_big',
  );
  const badLink = error.issues.some((issue) => issue.path.at(-1) === 'link');
  const code = tooManyAssignees
    ? ErrorCodes.invalidAssignee
    : badLink
      ? ErrorCodes.invalidUrl
      : ErrorCodes.validationFailed;
  return reply.code(400).send({ error: code });
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

  /**
   * After cards were made from a ticket (or a message of its chat): its page refetches, and the
   * ticket's audience hears `ticket.tasks` with the count. A failure is logged; the write
   * succeeded.
   */
  const afterTicketTasks = async (
    request: FastifyRequest,
    ticketId: string | null,
    count: number,
  ) => {
    if (ticketId === null) return;
    try {
      const ticket = await getTicketRow(db, ticketId);
      if (!ticket) return;
      emitTicket(app.io, 'updated', ticket);
      await runTicketChange(
        deps,
        { kind: 'tasks', ticket, actorId: request.user!.id, count },
        request.log,
      );
    } catch (error) {
      request.log.error({ err: error, ticketId }, 'could not announce the tasks of a ticket');
    }
  };

  /**
   * After a task made from a ticket changed (edited, moved, deleted): the ticket's page lists its
   * tasks, so it refetches. A failure is logged; the write succeeded.
   */
  const refreshTicket = async (request: FastifyRequest, ticketId: string | null) => {
    try {
      await emitTicketRefresh(app.io, db, ticketId);
    } catch (error) {
      request.log.error({ err: error, ticketId }, 'could not refresh the ticket of a task');
    }
  };

  /**
   * After a task made from a meeting changed (edited, moved, deleted): the meeting's detail lists
   * its tasks, so its readers refetch. A failure is logged; the write succeeded.
   */
  const refreshMeeting = async (request: FastifyRequest, meetingId: string | null) => {
    try {
      await emitMeetingTasks(app.io, db, meetingId);
    } catch (error) {
      request.log.error({ err: error, meetingId }, 'could not refresh the meeting of a task');
    }
  };

  /**
   * After a write changed time entries (Phase 32): the finance room and the users whose time
   * requests changed hear it. A failure is logged; the write succeeded.
   */
  const announceTime = async (request: FastifyRequest, time: TimeChange) => {
    try {
      await announceTimeChange(db, app.io, time);
    } catch (error) {
      request.log.error({ err: error }, 'could not announce a time change');
    }
  };

  /** The task's group, creator and source ticket and meeting when the actor may use its board, else null (404). */
  const readableTask = async (actor: SessionUser, id: string) => {
    const ref = await getTaskRef(db, id);
    if (!ref || !canUseBoard(actor, ref.groupId, await clientGroupIds(db, actor.id))) {
      return null;
    }
    return ref;
  };

  app.post<IdParams>('/groups/:id/tasks', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = TaskCreateSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    if (!(await canOpenGroup(actor, request.params.id))) return notFound(reply);
    let created;
    try {
      created = await createTaskTimed(deps, actor, request.params.id, body.data);
    } catch (error) {
      return writeError(reply, error);
    }
    // After the commit, outside the try: nothing here may be mapped as a failed write.
    const { task, askTime, time } = created;
    emitTask(app.io, toTaskDto(task), person(actor));
    await announceTime(request, time);
    return reply.code(201).send({ ...task, askTime });
  });

  /**
   * The reviewed cards of a chat message. The message must be live, readable by the actor and in
   * a channel (group or task chat) of this group; anything else answers 404 like a missing one.
   */
  app.post<IdParams>(
    '/groups/:id/tasks/from-message',
    { preHandler: writeGuard },
    async (request, reply) => {
      const actor = request.user!;
      const groupId = request.params.id;
      const body = TasksFromMessageSchema.safeParse(request.body);
      if (!body.success) return invalidBody(reply, body.error);
      if (!(await canOpenGroup(actor, groupId))) return notFound(reply);
      const found = await findReadableMessage(db, actor, body.data.messageId);
      if (!found || found.message.deletedAt !== null || found.channel.groupId !== groupId) {
        return notFound(reply);
      }
      const messageId = found.message.id;
      // A message of a ticket's chat links its cards to the ticket too (part 21.5).
      const ticketId = found.channel.ticketId;
      const source = {
        messageId,
        ticketId: ticketId ?? undefined,
        fileIds: (await getMessageFiles(db, groupId, messageId)).map((f) => f.id),
      };
      let created;
      try {
        created = await createTasksFromSource(deps, actor, groupId, body.data, source);
      } catch (error) {
        return writeError(reply, error);
      }
      // After the commit, outside the try: nothing here may be mapped as a failed write.
      for (const task of created) emitTask(app.io, toTaskDto(task), person(actor));
      await pushMessageTasks(request, messageId);
      await afterTicketTasks(request, ticketId, created.length);
      const result: TasksFromMessageResult = { tasks: created };
      return reply.code(201).send(result);
    },
  );

  /**
   * The reviewed cards of a ticket (part 21.5). The ticket must be of this group and readable by
   * the actor, who uses the group's board (admins and its clients, so never a ziadatel); anything
   * else answers 404 like a missing one. The files uploaded with the ticket may be copied.
   */
  app.post<IdParams>(
    '/groups/:id/tasks/from-ticket',
    { preHandler: writeGuard },
    async (request, reply) => {
      const actor = request.user!;
      const groupId = request.params.id;
      const body = TasksFromTicketSchema.safeParse(request.body);
      if (!body.success) return invalidBody(reply, body.error);
      if (!(await canOpenGroup(actor, groupId))) return notFound(reply);
      const ticket = await getTicketRow(db, body.data.ticketId);
      if (!ticket || ticket.groupId !== groupId || !(await actorReadsTicket(db, actor, ticket))) {
        return notFound(reply);
      }
      const source = { ticketId: ticket.id, fileIds: await attachmentIds(db, ticket.id) };
      let created;
      try {
        created = await createTasksFromSource(deps, actor, groupId, body.data, source);
      } catch (error) {
        return writeError(reply, error);
      }
      for (const task of created) emitTask(app.io, toTaskDto(task), person(actor));
      await afterTicketTasks(request, ticket.id, created.length);
      const result: TasksFromMessageResult = { tasks: created };
      return reply.code(201).send(result);
    },
  );

  app.get<IdParams>('/tasks/:id', { preHandler: anyUser }, async (request, reply) => {
    if (!(await readableTask(request.user!, request.params.id))) return notFound(reply);
    const task = await getTask(db, request.params.id, request.user!);
    return task ?? notFound(reply);
  });

  // 2026-10-17: the viewer opened the task's panel (either tab): its changes so far are seen.
  app.post<IdParams>('/tasks/:id/seen', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readableTask(actor, request.params.id))) return notFound(reply);
    await markTaskSeen(db, actor.id, request.params.id);
    emitSeen(app.io, actor.id, { kind: 'task', id: request.params.id });
    return reply.code(204).send();
  });

  app.patch<IdParams>('/tasks/:id', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = TaskPatchSchema.safeParse(request.body);
    if (!body.success) return invalidBody(reply, body.error);
    // Anyone who may use the board edits any of its tasks.
    const ref = await readableTask(actor, request.params.id);
    if (!ref) return notFound(reply);
    try {
      const { task, askTime, time } = await updateTaskTimed(
        deps,
        actor,
        request.params.id,
        body.data,
        { onFileCleanupError: logCleanupError(request) },
      );
      emitTask(app.io, toTaskDto(task), person(actor));
      await pushMessageTasks(request, task.sourceMessageId);
      await refreshTicket(request, ref.sourceTicketId);
      await refreshMeeting(request, ref.sourceMeetingId);
      await announceTime(request, time);
      return { ...task, askTime };
    } catch (error) {
      return writeError(reply, error);
    }
  });

  app.post<IdParams>('/tasks/:id/move', { preHandler: writeGuard }, async (request, reply) => {
    const actor = request.user!;
    const body = TaskMoveSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    // Anyone who may use the board moves any of its tasks.
    const ref = await readableTask(actor, request.params.id);
    if (!ref) return notFound(reply);
    try {
      const { task, moved, askTime, time } = await moveTask(
        deps,
        actor,
        request.params.id,
        body.data,
      );
      if (moved) {
        emitTask(app.io, task, person(actor));
        await pushMessageTasks(request, task.sourceMessageId);
        await refreshTicket(request, ref.sourceTicketId);
        await refreshMeeting(request, ref.sourceMeetingId);
        await announceTime(request, time);
      }
      return { ...task, askTime };
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
      const { groupId, sourceMessageId, sourceTicketId, sourceMeetingId, time } = await deleteTask(
        deps,
        request.params.id,
        { onFileCleanupError: logCleanupError(request) },
      );
      emitTaskDeleted(app.io, groupId, request.params.id);
      await pushMessageTasks(request, sourceMessageId);
      await refreshTicket(request, sourceTicketId);
      await refreshMeeting(request, sourceMeetingId);
      await announceTime(request, time);
      return reply.code(204).send();
    } catch (error) {
      return writeError(reply, error);
    }
  });
};
