import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  EditMessageInputSchema,
  ID_RE,
  ErrorCodes,
  isPickable,
  MarkReadInputSchema,
  MESSAGE_PAGE_SIZE,
  SendMessageInputSchema,
  SetReactionInputSchema,
  type GroupChannel,
  type MessageDto,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { InvalidAttachmentError } from '../files/service.js';
import { requireUser } from '../auth/session.js';
import { isAdmin } from '../users/policy.js';
import { canReadGroup } from '../groups/policy.js';
import { getGroup, listGroupPeople } from '../groups/service.js';
import { getTaskRef } from '../tasks/task-service.js';
import { getSharedItem } from '../knowledge/service.js';
import { emitMessage, emitReactions, emitRead, emitThreadReply } from './events.js';
import {
  InvalidKnowledgeItemError,
  isAttached,
  KnowledgeShareForbiddenError,
} from './knowledge-links.js';
import { forRequester, InvalidWorkError, WorkAttachForbiddenError } from './work-links.js';
import { reactionPeople, setReaction, TooManyEmojiError } from './reactions.js';
import { prepareFilesRemoved, runFilesSent } from './file-hooks.js';
import {
  EmptyMessageError,
  InvalidMentionError,
  InvalidThreadError,
  MessageDeletedError,
  deleteMessage,
  editMessage,
  findReadableMessage,
  sendMessage,
} from './messages.js';
import { canDeleteMessage, canEditMessage, canReact, isMessageAuthor } from './policy.js';
import { actorReadsChannel, channelKindAccess, extraRoomsOf } from './access.js';
import {
  changesAfter,
  getThread,
  pageAfter,
  pageAround,
  pageBefore,
  parseCursor,
} from './reads.js';
import {
  ChannelGoneError,
  ensureGroupChannel,
  ensureTaskChannel,
  getChannel,
  getLastReadAt,
  getTicketChannel,
  markAllRead,
  markRead,
  markThreadRead,
  unreadByGroup,
  unreadCount,
  unreadThreads,
  taskChatSummaries,
  TaskGoneError,
  type ChannelRow,
} from './service.js';
import { clientGroupIds } from '../groups/memberships.js';

type IdParams = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });
const invalid = (reply: FastifyReply) =>
  reply.code(400).send({ error: ErrorCodes.validationFailed });

const LimitSchema = z.coerce.number().int().min(1).max(MESSAGE_PAGE_SIZE);
const MessagesQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: LimitSchema.optional(),
});
const AroundQuerySchema = z.object({ limit: LimitSchema.optional() });
// change_seq is a Postgres integer: a larger value would fail in the query.
const ChangesQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).max(2_147_483_647),
});

export const chatRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const anyUser = requireUser(app.auth);
  const allowSend = createRateLimiter({ windowMs: 60_000, max: 30 });
  const allowReact = createRateLimiter({ windowMs: 60_000, max: 60 });

  /**
   * The channel when the actor may read it; otherwise answers 404 and returns null (an
   * unreadable channel looks the same as a missing one).
   */
  const readableChannel = async (
    request: FastifyRequest,
    reply: FastifyReply,
    channelId: string,
  ): Promise<ChannelRow | null> => {
    const actor = request.user!;
    // A malformed id cannot exist; checking first keeps NUL and the like away from Postgres.
    const channel = ID_RE.test(channelId) ? await getChannel(db, channelId) : null;
    if (channel && (await actorReadsChannel(db, actor, channel))) return channel;
    notFound(reply);
    return null;
  };

  /**
   * Task links lead to the group's board: someone who reads a channel but not its group (a
   * ziadatel in a ticket chat) gets the messages without them (part 21.5).
   */
  const forReader = async <T extends { messages: MessageDto[] }>(
    actor: SessionUser,
    channel: ChannelRow,
    page: T,
  ): Promise<T> => {
    if (channel.kind === 'group' || channel.kind === 'task') return page;
    if (canReadGroup(actor, channel.groupId, await clientGroupIds(db, actor.id))) return page;
    return { ...page, messages: await forRequester(db, channel, page.messages) };
  };

  /** What the channel's extra rooms (a ticket's initiator) get: the message as a requester sees it. */
  const requesterCopy = async (
    channel: ChannelRow,
    rooms: string[],
    message: MessageDto,
  ): Promise<MessageDto | undefined> =>
    rooms.length === 0 ? undefined : (await forRequester(db, channel, [message]))[0];

  /** A message with its readable channel, or a 404 answer and null. */
  const readableMessage = async (request: FastifyRequest, reply: FastifyReply, id: string) => {
    const found = await findReadableMessage(db, request.user!, id);
    if (!found) notFound(reply);
    return found;
  };

  /** The answer of both chat entry points: the channel with the actor's read mark and unread count. */
  const channelInfo = async (actorId: string, channel: ChannelRow): Promise<GroupChannel> => {
    const [lastReadAt, unread] = await Promise.all([
      getLastReadAt(db, actorId, channel.id),
      unreadCount(db, actorId, channel.id),
    ]);
    return {
      id: channel.id,
      lastSeq: channel.lastSeq,
      lastReadAt: lastReadAt?.toISOString() ?? null,
      unread,
    };
  };

  app.get<IdParams>('/groups/:id/chat', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!ID_RE.test(id)) return notFound(reply);
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    if (!(await getGroup(db, id))) return notFound(reply);
    return channelInfo(actor.id, await ensureGroupChannel(db, id));
  });

  // The board's chat icons: count and unread flag of every task chat of the group, one query.
  app.get<IdParams>('/groups/:id/task-chats', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!ID_RE.test(id)) return notFound(reply);
    if (!canReadGroup(actor, id, await clientGroupIds(db, actor.id))) return notFound(reply);
    if (!(await getGroup(db, id))) return notFound(reply);
    return taskChatSummaries(db, actor.id, id);
  });

  // A ticket's chat (Phase 21): read by whoever reads the ticket (the ticket module's rules). A
  // ticket without a client has no chat yet: 404 like an unreadable one.
  app.get<IdParams>('/tickets/:id/chat', { preHandler: anyUser }, async (request, reply) => {
    const { id } = request.params;
    const channel = ID_RE.test(id) ? await getTicketChannel(db, id) : null;
    if (!channel || !(await actorReadsChannel(db, request.user!, channel))) {
      return notFound(reply);
    }
    return channelInfo(request.user!.id, channel);
  });

  // Who can be mentioned in a channel: the group's pickable people (its clients and managers)
  // plus the channel kind's own (a ticket's initiator). For anyone who reads the channel, so a
  // ziadatel, who cannot read the group's people, still sees names in a ticket chat.
  app.get<IdParams>('/channels/:id/people', { preHandler: anyUser }, async (request, reply) => {
    const channel = await readableChannel(request, reply, request.params.id);
    if (!channel) return reply;
    const people = (await listGroupPeople(db, channel.groupId)).filter(isPickable);
    const access = channelKindAccess(channel);
    const known = new Set(people.map((p) => p.id));
    for (const p of access ? await access.extraPeople(db, channel) : []) {
      if (!known.has(p.id))
        people.push({ id: p.id, name: p.name, isAdmin: false, isManager: false });
    }
    return people;
  });

  // A task chat is read by whoever can read the task's group, like the group chat.
  app.get<IdParams>('/tasks/:id/chat', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const { id } = request.params;
    if (!ID_RE.test(id)) return notFound(reply);
    const task = await getTaskRef(db, id);
    if (!task) return notFound(reply);
    if (!canReadGroup(actor, task.groupId, await clientGroupIds(db, actor.id))) {
      return notFound(reply);
    }
    try {
      return await channelInfo(actor.id, await ensureTaskChannel(db, { id, ...task }));
    } catch (error) {
      if (error instanceof TaskGoneError) return notFound(reply);
      throw error;
    }
  });

  app.get<IdParams>('/channels/:id/messages', { preHandler: anyUser }, async (request, reply) => {
    const query = MessagesQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const { before, after, limit } = query.data;
    if (before !== undefined && after !== undefined) return invalid(reply);
    const channel = await readableChannel(request, reply, request.params.id);
    if (!channel) return reply;
    const cursorText = after ?? before;
    const cursor = cursorText === undefined ? null : parseCursor(cursorText);
    if (cursorText !== undefined && !cursor) return invalid(reply);
    const actor = request.user!;
    const page =
      after !== undefined
        ? await pageAfter(db, channel, actor.id, cursor!, limit)
        : await pageBefore(db, channel, actor.id, cursor, limit);
    return forReader(actor, channel, page);
  });

  app.get<IdParams>('/channels/:id/changes', { preHandler: anyUser }, async (request, reply) => {
    const query = ChangesQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const channel = await readableChannel(request, reply, request.params.id);
    if (!channel) return reply;
    return forReader(request.user!, channel, await changesAfter(db, channel, query.data.afterSeq));
  });

  app.get<IdParams>('/messages/:id/thread', { preHandler: anyUser }, async (request, reply) => {
    const found = await readableMessage(request, reply, request.params.id);
    if (!found) return reply;
    const thread = await getThread(db, found.channel, found.message.id);
    if (!thread) return notFound(reply);
    const {
      messages: [root, ...replies],
    } = await forReader(request.user!, found.channel, {
      messages: [thread.root, ...thread.replies],
    });
    return { root: root!, replies };
  });

  app.get<IdParams>('/messages/:id/around', { preHandler: anyUser }, async (request, reply) => {
    const query = AroundQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const found = await readableMessage(request, reply, request.params.id);
    if (!found) return reply;
    const page = await pageAround(
      db,
      found.channel,
      request.user!.id,
      found.message.id,
      query.data.limit,
    );
    return page ? forReader(request.user!, found.channel, page) : notFound(reply);
  });

  app.post<IdParams>('/channels/:id/messages', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const channel = await readableChannel(request, reply, request.params.id);
    if (!channel) return reply;
    const body = SendMessageInputSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    if (!allowSend(actor.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    try {
      const sent = await sendMessage(deps, { channel, author: actor, data: body.data });
      if (!sent.created) return reply.code(200).send(sent.message);
      const rooms = await extraRoomsOf(db, channel);
      const copy = await requesterCopy(channel, rooms, sent.message);
      emitMessage(app.io, channel, sent.message, true, rooms, copy);
      if (sent.message.attachments.length > 0) {
        await runFilesSent(db, app.io, sent.message.id).catch((error: unknown) =>
          request.log.error({ err: error }, 'chat: file listeners after send failed'),
        );
      }
      if (sent.parent) {
        emitMessage(
          app.io,
          channel,
          sent.parent,
          false,
          rooms,
          await requesterCopy(channel, rooms, sent.parent),
        );
        emitThreadReply(app.io, sent.threadPeople, {
          groupId: channel.groupId,
          channelId: channel.id,
          taskId: channel.taskId,
          rootId: sent.parent.id,
        });
      }
      return reply.code(201).send(sent.message);
    } catch (error) {
      if (error instanceof InvalidMentionError) {
        return reply.code(400).send({ error: ErrorCodes.invalidMention });
      }
      if (error instanceof InvalidAttachmentError) {
        return reply.code(400).send({ error: ErrorCodes.invalidAttachment });
      }
      if (error instanceof InvalidKnowledgeItemError) {
        return reply.code(400).send({ error: ErrorCodes.invalidKnowledgeItem });
      }
      if (error instanceof InvalidWorkError) {
        return reply.code(400).send({ error: ErrorCodes.invalidAttachment });
      }
      if (
        error instanceof KnowledgeShareForbiddenError ||
        error instanceof WorkAttachForbiddenError
      ) {
        return forbidden(reply);
      }
      if (error instanceof InvalidThreadError || error instanceof EmptyMessageError) {
        return invalid(reply);
      }
      if (error instanceof ChannelGoneError) return notFound(reply);
      throw error;
    }
  });

  app.patch<IdParams>('/messages/:id', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const found = await readableMessage(request, reply, request.params.id);
    if (!found) return reply;
    const body = EditMessageInputSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    // Someone else's message is forbidden; the author's own deleted message is gone (404).
    if (!canEditMessage(actor, found.message)) {
      return isMessageAuthor(actor, found.message) ? notFound(reply) : forbidden(reply);
    }
    try {
      const message = await editMessage(deps, { ...found, body: body.data.body });
      {
        const rooms = await extraRoomsOf(db, found.channel);
        emitMessage(
          app.io,
          found.channel,
          message,
          false,
          rooms,
          await requesterCopy(found.channel, rooms, message),
        );
      }
      return message;
    } catch (error) {
      if (error instanceof InvalidMentionError) {
        return reply.code(400).send({ error: ErrorCodes.invalidMention });
      }
      if (error instanceof EmptyMessageError) return invalid(reply);
      if (error instanceof MessageDeletedError || error instanceof ChannelGoneError) {
        return notFound(reply);
      }
      throw error;
    }
  });

  app.delete<IdParams>('/messages/:id', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const found = await readableMessage(request, reply, request.params.id);
    if (!found) return reply;
    if (!isMessageAuthor(actor, found.message)) return forbidden(reply);
    // Deleting twice is a no-op: nothing changes, so nothing is pushed.
    if (!canDeleteMessage(actor, found.message)) return reply.code(204).send();
    try {
      // The ids of other modules' rows for its files, read before they cascade away.
      const pushRemoved = await prepareFilesRemoved(db, found.message.id);
      const message = await deleteMessage(deps, {
        ...found,
        onFileCleanupError: (error) =>
          request.log.error({ err: error }, 'chat: file cleanup after message delete failed'),
      });
      {
        const rooms = await extraRoomsOf(db, found.channel);
        emitMessage(
          app.io,
          found.channel,
          message,
          false,
          rooms,
          await requesterCopy(found.channel, rooms, message),
        );
      }
      pushRemoved(app.io);
      return reply.code(204).send();
    } catch (error) {
      // The chat went with its task (or group) while this delete waited for the channel lock.
      if (error instanceof ChannelGoneError) return notFound(reply);
      throw error;
    }
  });

  // Phase 28: the actor's reaction with one emoji is on or off (idempotent). Pushed only when it
  // changed something; no notification of any kind.
  app.put<IdParams>('/messages/:id/reactions', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const found = await readableMessage(request, reply, request.params.id);
    if (!found) return reply;
    if (!canReact(found.message)) return notFound(reply);
    const body = SetReactionInputSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    if (!allowReact(actor.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    try {
      const result = await setReaction(db, {
        channel: found.channel,
        messageId: found.message.id,
        userId: actor.id,
        ...body.data,
      });
      if (!result) return notFound(reply);
      const { changed, ...answer } = result;
      if (changed) {
        emitReactions(
          app.io,
          {
            groupId: found.channel.groupId,
            channelId: found.channel.id,
            taskId: found.channel.taskId,
            parentId: found.message.parentId,
            ...answer,
          },
          await extraRoomsOf(db, found.channel),
        );
      }
      return answer;
    } catch (error) {
      if (error instanceof TooManyEmojiError) return invalid(reply);
      if (error instanceof ChannelGoneError) return notFound(reply);
      throw error;
    }
  });

  // Who reacted with what (the chips' hover and long press), for any reader of the channel.
  app.get<IdParams>('/messages/:id/reactions', { preHandler: anyUser }, async (request, reply) => {
    const found = await readableMessage(request, reply, request.params.id);
    if (!found) return reply;
    return found.message.deletedAt === null ? reactionPeople(db, found.message.id) : [];
  });

  // Phase 28: an item attached to a message, read-only, for any reader of the message's channel
  // (a ziadatel in their ticket chat opens it here): the message is live, the item attached to
  // it and still visible to everyone in the chat. Anything else is 404.
  app.get<{ Params: { id: string; itemId: string } }>(
    '/messages/:id/knowledge/:itemId',
    { preHandler: anyUser },
    async (request, reply) => {
      const { itemId } = request.params;
      const found = await readableMessage(request, reply, request.params.id);
      if (!found) return reply;
      if (found.message.deletedAt !== null || !ID_RE.test(itemId)) return notFound(reply);
      if (!(await isAttached(db, found.message.id, itemId))) return notFound(reply);
      const item = await getSharedItem(db, itemId, found.channel.groupId);
      return item ?? notFound(reply);
    },
  );

  app.post<IdParams>('/channels/:id/read', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const channel = await readableChannel(request, reply, request.params.id);
    if (!channel) return reply;
    const body = MarkReadInputSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const lastReadAt = await markRead(db, actor.id, channel.id, new Date(body.data.at));
    emitRead(app.io, actor.id, {
      groupId: channel.groupId,
      channelId: channel.id,
      taskId: channel.taskId,
      lastReadAt: lastReadAt.toISOString(),
    });
    return reply.code(204).send();
  });

  // Opening a task's Chat tab: the whole chat is read, the user's threads included.
  app.post<IdParams>('/channels/:id/read-all', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const channel = await readableChannel(request, reply, request.params.id);
    if (!channel) return reply;
    try {
      const lastReadAt = await markAllRead(db, actor.id, channel.id);
      emitRead(app.io, actor.id, {
        groupId: channel.groupId,
        channelId: channel.id,
        taskId: channel.taskId,
        lastReadAt: lastReadAt.toISOString(),
        all: true,
      });
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof ChannelGoneError) return notFound(reply);
      throw error;
    }
  });

  app.get<IdParams>(
    '/channels/:id/unread-threads',
    { preHandler: anyUser },
    async (request, reply) => {
      const channel = await readableChannel(request, reply, request.params.id);
      if (!channel) return reply;
      return unreadThreads(db, request.user!.id, channel.id);
    },
  );

  // Opening a thread reads it; for someone who is not one of its people this changes nothing.
  app.post<IdParams>(
    '/messages/:id/thread/read',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      const found = await readableMessage(request, reply, request.params.id);
      if (!found) return reply;
      const rootId = found.message.parentId ?? found.message.id;
      const lastReadAt = await markThreadRead(db, actor.id, rootId);
      if (lastReadAt) {
        emitRead(app.io, actor.id, {
          groupId: found.channel.groupId,
          channelId: found.channel.id,
          taskId: found.channel.taskId,
          lastReadAt: lastReadAt.toISOString(),
          rootId,
        });
      }
      return reply.code(204).send();
    },
  );

  app.get('/chat/unread', { preHandler: anyUser }, async (request) => {
    const actor = request.user!;
    if (isAdmin(actor)) return unreadByGroup(db, actor.id, null);
    // unreadByGroup checks no permissions: a client only ever asks for their own client groups.
    const groupIds = await clientGroupIds(db, actor.id);
    return groupIds.length === 0 ? {} : unreadByGroup(db, actor.id, groupIds);
  });
};
