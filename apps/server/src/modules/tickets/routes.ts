import { timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  ErrorCodes,
  TicketCreateBodySchema,
  TicketGroupBodySchema,
  TicketIntakeBodySchema,
  TicketListQuerySchema,
  TicketPatchBodySchema,
  type SessionUser,
  type TicketIntakeResponse,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { decodeFileNameHeader } from '../files/file-name.js';
import {
  createFile,
  FileTooLargeError,
  InvalidAttachmentError,
  MAX_FILE_BYTES,
} from '../files/service.js';
import { findGroupByEgrantUrl, getGroup } from '../groups/service.js';
import { getUserById } from '../users/service.js';
import { isAdmin } from '../users/policy.js';
import { bodyExcerpt, ticketCreatedEmail } from './emails.js';
import { emitTicket } from './events.js';
import { runTicketChange } from './hooks.js';
import { canCreateTicket, canEditTicket } from './policy.js';
import {
  actorReadsTicket,
  assignTicketGroup,
  claimRequesterEmail,
  createTicket,
  findTicketByRequestId,
  follow,
  getTicketForActor,
  getTicketRow,
  InvalidTicketCursorError,
  listFollowers,
  listTickets,
  roleIn,
  TicketHasTasksError,
  unfollow,
  updateTicket,
  type TicketRow,
} from './service.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

const intakeAnswer = (ticket: TicketRow): TicketIntakeResponse => ({
  id: ticket.id,
  number: ticket.number,
});

/** Constant-time comparison of the Bearer key. */
function keyMatches(header: string | undefined, key: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const wanted = Buffer.from(key);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Tickets (Phase 21): the intake API for eGrant, manual creation, lists, edits and following. */
export const ticketsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config, jobs } = deps;
  const anyUser = requireUser(app.auth);
  const adminOnly = requireAdmin(app.auth);
  const allowIntake = createRateLimiter({ windowMs: 60_000, max: 60 });
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 120 });

  /** The "Ticket created" email, once per ticket; a queue failure never undoes the ticket. */
  async function mailRequester(ticket: TicketRow, log: FastifyBaseLogger): Promise<void> {
    if (!ticket.requesterUserId) return;
    try {
      const account = await getUserById(db, ticket.requesterUserId);
      if (!account || account.disabledAt || !(await claimRequesterEmail(db, ticket.id))) return;
      const url = `${config.publicUrl}/login?redirect=${encodeURIComponent(`/tickets/${ticket.id}`)}`;
      await sendEmailLater(
        jobs,
        ticketCreatedEmail(
          account.email,
          {
            number: ticket.number,
            subject: ticket.subject,
            excerpt: bodyExcerpt(ticket.body),
            url,
          },
          account.language,
        ),
      );
    } catch (error) {
      log.error({ err: error, ticketId: ticket.id }, 'ticket created email failed');
    }
  }

  async function afterCreate(
    request: FastifyRequest,
    ticket: TicketRow,
    notifyRequester: boolean,
  ): Promise<void> {
    if (notifyRequester) await mailRequester(ticket, request.log);
    emitTicket(app.io, 'created', ticket);
    await runTicketChange(
      deps,
      { kind: 'created', ticket, actorId: request.user?.id ?? null },
      request.log,
    );
  }

  // ---- eGrant intake: the shared key is the credential, no session -------------------------
  app.post('/tickets/intake', async (request, reply) => {
    if (!config.ticketsApiKey) return send(reply, 503, ErrorCodes.intakeDisabled);
    if (!keyMatches(request.headers.authorization, config.ticketsApiKey)) {
      return send(reply, 401, ErrorCodes.unauthorized);
    }
    if (!allowIntake(request.ip)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = TicketIntakeBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: ErrorCodes.validationFailed,
        fields: [...new Set(body.error.issues.map((i) => i.path.join('.') || 'body'))],
      });
    }
    const b = body.data;
    // A retry of a request already taken answers its ticket and repeats nothing.
    const earlier = b.request_id ? await findTicketByRequestId(db, b.request_id) : null;
    if (earlier) return reply.code(200).send(intakeAnswer(earlier));
    const group = await findGroupByEgrantUrl(db, b.instance_url);
    const { ticket, notifyRequester, duplicate } = await createTicket(deps, {
      source: 'api',
      groupId: group?.id ?? null,
      createdBy: null,
      fields: {
        area: b.area,
        subject: b.subject,
        programme: b.programme,
        body: b.body,
        dueDate: b.due_date,
        url: b.url,
        fileLinks: b.file_links,
      },
      requester: { email: b.email, name: b.requester_name, phone: b.phone },
      // Kept as received, so admins see what eGrant sent even when no client matched.
      instanceUrl: b.instance_url,
      requestId: b.request_id,
    });
    // A concurrent duplicate lost the race to the unique key: the winner does the rest.
    if (duplicate) return reply.code(200).send(intakeAnswer(ticket));
    await afterCreate(request, ticket, notifyRequester);
    return reply.code(201).send(intakeAnswer(ticket));
  });

  // ---- Manual creation ------------------------------------------------------------------------
  app.post('/tickets', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = TicketCreateBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const b = body.data;
    if (!(await getGroup(db, b.groupId))) return notFound(reply);
    const role = await roleIn(db, actor, b.groupId);
    if (!isAdmin(actor) && role === null) return notFound(reply);
    if (!canCreateTicket(actor, role)) return send(reply, 403, ErrorCodes.forbidden);
    // A client is the initiator; an admin names one (or none).
    const requester = isAdmin(actor)
      ? { email: b.requesterEmail, name: b.requesterName, phone: b.requesterPhone }
      : { email: actor.email, name: actor.name, phone: b.requesterPhone };
    try {
      const { ticket, notifyRequester } = await createTicket(deps, {
        source: 'manual',
        groupId: b.groupId,
        createdBy: actor.id,
        fields: {
          area: b.area,
          subject: b.subject,
          programme: b.programme,
          body: b.body,
          dueDate: b.dueDate,
          url: b.url,
          fileLinks: b.fileLinks,
        },
        requester,
        fileIds: b.fileIds,
      });
      await afterCreate(request, ticket, notifyRequester);
      return reply.code(201).send(await getTicketForActor(db, actor, ticket.id));
    } catch (error) {
      if (error instanceof InvalidAttachmentError)
        return send(reply, 400, ErrorCodes.invalidAttachment);
      throw error;
    }
  });

  // ---- Lists ------------------------------------------------------------------------------------
  const listOr400 = async (
    reply: FastifyReply,
    run: (query: ReturnType<typeof TicketListQuerySchema.parse>) => Promise<unknown>,
    raw: unknown,
  ) => {
    const query = TicketListQuerySchema.safeParse(raw);
    if (!query.success) return send(reply, 400, 'invalid_filter');
    try {
      return await run(query.data);
    } catch (error) {
      if (error instanceof InvalidTicketCursorError) return send(reply, 400, 'invalid_filter');
      throw error;
    }
  };

  app.get('/tickets/global', { preHandler: adminOnly }, async (request, reply) =>
    listOr400(reply, (q) => listTickets(db, request.user!, { kind: 'global' }, q), request.query),
  );

  app.get('/tickets/mine', { preHandler: anyUser }, async (request, reply) =>
    listOr400(reply, (q) => listTickets(db, request.user!, { kind: 'mine' }, q), request.query),
  );

  app.get<IdParams>('/groups/:id/tickets', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const groupId = request.params.id;
    const role = await roleIn(db, actor, groupId);
    if ((!isAdmin(actor) && role === null) || !(await getGroup(db, groupId))) {
      return notFound(reply);
    }
    return listOr400(
      reply,
      (q) => listTickets(db, actor, { kind: 'group', groupId, role }, q),
      request.query,
    );
  });

  // ---- One ticket ---------------------------------------------------------------------------------
  /** The ticket if the actor reads it, else a 404 already sent. */
  const readable = async (actor: SessionUser, id: string, reply: FastifyReply) => {
    const row = await getTicketRow(db, id);
    if (!row || !(await actorReadsTicket(db, actor, row))) {
      notFound(reply);
      return null;
    }
    return row;
  };

  app.get<IdParams>('/tickets/:id', { preHandler: anyUser }, async (request, reply) => {
    const dto = await getTicketForActor(db, request.user!, request.params.id);
    return dto ?? notFound(reply);
  });

  app.patch<IdParams>('/tickets/:id', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readable(actor, request.params.id, reply))) return reply;
    if (!canEditTicket(actor)) return send(reply, 403, ErrorCodes.forbidden);
    const body = TicketPatchBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const result = await updateTicket(db, request.params.id, body.data);
    if (!result) return notFound(reply);
    const { ticket, statusChanged, fieldsChanged } = result;
    if (statusChanged || fieldsChanged) {
      emitTicket(app.io, 'updated', ticket);
      const change = { ticket, actorId: actor.id };
      if (statusChanged) await runTicketChange(deps, { ...change, kind: 'status' }, request.log);
      if (fieldsChanged) await runTicketChange(deps, { ...change, kind: 'updated' }, request.log);
    }
    return getTicketForActor(db, actor, ticket.id);
  });

  app.put<IdParams>('/tickets/:id/group', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readable(actor, request.params.id, reply))) return reply;
    if (!canEditTicket(actor)) return send(reply, 403, ErrorCodes.forbidden);
    const body = TicketGroupBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    if (!(await getGroup(db, body.data.groupId))) return notFound(reply);
    try {
      const result = await assignTicketGroup(db, request.params.id, body.data.groupId);
      if (!result) return notFound(reply);
      const { ticket, previousGroupId, notifyRequester } = result;
      if (previousGroupId !== ticket.groupId) {
        if (notifyRequester) await mailRequester(ticket, request.log);
        if (previousGroupId) {
          emitTicket(app.io, 'moved', { ...ticket, groupId: previousGroupId });
        }
        emitTicket(app.io, previousGroupId ? 'updated' : 'created', ticket);
        await runTicketChange(
          deps,
          {
            kind: previousGroupId ? 'moved' : 'created',
            ticket,
            actorId: actor.id,
            previousGroupId,
          },
          request.log,
        );
      }
      return getTicketForActor(db, actor, ticket.id);
    } catch (error) {
      if (error instanceof TicketHasTasksError) return send(reply, 409, ErrorCodes.hasTasks);
      throw error;
    }
  });

  app.put<IdParams>('/tickets/:id/follow', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readable(actor, request.params.id, reply))) return reply;
    await follow(db, request.params.id, actor.id);
    return reply.code(204).send();
  });

  app.delete<IdParams>('/tickets/:id/follow', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readable(actor, request.params.id, reply))) return reply;
    await unfollow(db, request.params.id, actor.id);
    return reply.code(204).send();
  });

  // ---- Files for the ticket chat ------------------------------------------------------------------
  // Whoever reads the ticket uploads into its client's files, so a ziadatel, who cannot use
  // `POST /api/groups/:id/files`, can attach files in the ticket chat. Streamed like that route.
  const allowUpload = createRateLimiter({ windowMs: 60_000, max: 60 });
  await app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

    upload.post<IdParams>('/tickets/:id/files', { preHandler: anyUser }, async (request, reply) => {
      const actor = request.user!;
      const row = await readable(actor, request.params.id, reply);
      if (!row) return reply;
      if (row.groupId === null) return send(reply, 409, ErrorCodes.noClient);
      if (!allowUpload(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
      const tooLarge = () =>
        reply.code(413).header('connection', 'close').send({ error: ErrorCodes.fileTooLarge });
      if (Number(request.headers['content-length']) > MAX_FILE_BYTES) return tooLarge();
      try {
        const info = await createFile(deps, {
          groupId: row.groupId,
          uploadedBy: actor.id,
          name: decodeFileNameHeader(request.headers['x-file-name'] as string | undefined),
          declaredType: request.headers['content-type'],
          body: request.raw,
        });
        return reply.code(201).send(info);
      } catch (error) {
        if (error instanceof FileTooLargeError) return tooLarge();
        throw error;
      }
    });
  });

  app.get<IdParams>('/tickets/:id/followers', { preHandler: anyUser }, async (request, reply) => {
    if (!(await readable(request.user!, request.params.id, reply))) return reply;
    return listFollowers(db, request.params.id);
  });
};
