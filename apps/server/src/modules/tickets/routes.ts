import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  base64DecodedSize,
  ErrorCodes,
  intakeFieldNames,
  isValidGlobalProjectFilter,
  isValidProjectFilter,
  TICKET_LIMITS,
  TicketCreateBodySchema,
  TicketGroupBodySchema,
  TicketIntakeBodySchema,
  TicketListQuerySchema,
  TicketPatchBodySchema,
  TicketProjectBodySchema,
  TicketWatchSchema,
  type SessionUser,
  type TicketIntakeBody,
  type TicketIntakeResponse,
  type UnseenSummary,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { bearerKeyMatches } from '../../infra/http/bearer-key.js';
import { egrantSignature } from '../../infra/http/egrant-signature.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin, requireUser } from '../auth/session.js';
import { TICKET_LINK_EMAIL_JOB_OPTIONS, ticketEmailUrl } from '../auth/ticket-link.js';
import { decodeFileNameHeader } from '../files/file-name.js';
import {
  createFile,
  createReceivedFile,
  deleteFiles,
  FileTooLargeError,
  InvalidAttachmentError,
  MAX_FILE_BYTES,
} from '../files/service.js';
import { sniffAllowedType } from '../files/sniff.js';
import { findGroupByEgrantUrl, getGroup } from '../groups/service.js';
import { InvalidKnowledgeLinkError } from '../knowledge/links.js';
import { canSetTicketProject } from '../projects/policy.js';
import { InvalidProjectError } from '../projects/refs.js';
import { getUserById } from '../users/service.js';
import { isAdmin } from '../users/policy.js';
import { bodyExcerpt, ticketCreatedEmail } from './emails.js';
import { intakeProjectLink } from './egrant-link.js';
import { emitTicket } from './events.js';
import { runTicketChange } from './hooks.js';
import {
  canAssignTicket,
  canCreateTicket,
  canEditTicket,
  canHoldTickets,
  canWatchTickets,
} from './policy.js';
import {
  actorReadsTicket,
  addAssignee,
  assigneeCandidates,
  assignTicketGroup,
  claimRequesterEmail,
  createTicket,
  findTicketByRequestId,
  getTicketForActor,
  getTicketRow,
  InvalidTicketAssigneeError,
  InvalidTicketCursorError,
  listTickets,
  removeAssignee,
  roleIn,
  InvalidTicketGroupError,
  TicketHasTasksError,
  recordTicketMentions,
  updateTicket,
  type TicketRow,
} from './service.js';
import { setTicketWatch, watchesTickets } from './watch.js';
import { setTicketProject } from './project-links.js';
import { announceTimeChange, type TimeChange } from '../finance/task-time.js';
import { emitFinanceChanged } from '../finance/events.js';
import { requestDelivery } from '../notifications/service.js';
import { readSubject } from '../notifications/subject-read.js';
import { emitSeen, markTicketSeen, ticketUnseenSummary } from '../notifications/unseen.js';
import { egrantActor } from '../audit/actor.js';
import { auditActorOf } from '../audit/request-actor.js';
import { normalizeEgrantUrl } from '../groups/egrant-url.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const notFound = (reply: FastifyReply) => send(reply, 404, ErrorCodes.notFound);
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

const intakeAnswer = (ticket: TicketRow): TicketIntakeResponse => ({
  id: ticket.id,
  number: ticket.number,
});

/**
 * The sizes of the intake's files from their base64 length: the field of a file over the limit,
 * `files` when they are over it together, null when they fit.
 */
function oversizedField(files: TicketIntakeBody['files']): string | null {
  let total = 0;
  for (const [i, file] of files.entries()) {
    const size = base64DecodedSize(file.content_base64);
    if (size > TICKET_LIMITS.intakeFileBytes) return `files[${i}].content_base64`;
    total += size;
  }
  return total > TICKET_LIMITS.intakeTotalBytes ? 'files' : null;
}

/**
 * Decodes the intake's files and sniffs their type: the bytes and type of each, or the fields of
 * the files whose type Spolu does not take.
 */
function decodeFiles(
  files: TicketIntakeBody['files'],
):
  | { ok: true; files: { name: string; mime: string; bytes: Buffer }[] }
  | { ok: false; fields: string[] } {
  const decoded: { name: string; mime: string; bytes: Buffer }[] = [];
  const fields: string[] = [];
  for (const [i, file] of files.entries()) {
    const bytes = Buffer.from(file.content_base64, 'base64');
    const mime = sniffAllowedType(bytes, file.name);
    if (mime === null) fields.push(`files[${i}].content_base64`);
    // After the first bad file, keep only checking: the bytes would never be stored.
    else if (fields.length === 0) decoded.push({ name: file.name, mime, bytes });
  }
  return fields.length > 0 ? { ok: false, fields } : { ok: true, files: decoded };
}

/** Tickets (Phase 21): the intake API for eGrant, manual creation, lists, edits, riešitelia and watching. */
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
      // A ziadatel's button signs them in at once (ADR 0022); anyone else's goes to the login page.
      const { url, oneClick } = await ticketEmailUrl(db, config.publicUrl, account, ticket.id);
      await sendEmailLater(
        jobs,
        ticketCreatedEmail(
          { to: account.email, lang: account.language, publicUrl: config.publicUrl },
          {
            number: ticket.number,
            subject: ticket.subject,
            excerpt: bodyExcerpt(ticket.body),
            url,
            oneClick,
          },
        ),
        TICKET_LINK_EMAIL_JOB_OPTIONS,
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
  // The rate limit and the key are checked before the body (up to 28 MiB) is read. The limit
  // comes first and counts every call, so wrong keys are limited too (as on the managers webhook).
  const intakeGate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.ticketsApiKey) return send(reply, 503, ErrorCodes.intakeDisabled);
    if (!allowIntake(request.ip)) return send(reply, 429, ErrorCodes.rateLimited);
    if (!bearerKeyMatches(request.headers.authorization, config.ticketsApiKey)) {
      return send(reply, 401, ErrorCodes.unauthorized);
    }
  };

  app.post(
    '/tickets/intake',
    {
      onRequest: intakeGate,
      bodyLimit: TICKET_LIMITS.intakeBodyBytes,
      // Optional HMAC signature (EGRANT_TICKETS_SIGNING_SECRET, ADR 0042), after the key.
      ...egrantSignature(config, 'tickets'),
    },
    async (request, reply) => {
      const body = TicketIntakeBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: ErrorCodes.validationFailed,
          fields: intakeFieldNames(body.error.issues),
        });
      }
      const b = body.data;
      const oversized = oversizedField(b.files);
      if (oversized) {
        return reply.code(413).send({ error: ErrorCodes.fileTooLarge, fields: [oversized] });
      }
      // A retry of a request already taken answers its ticket and repeats nothing: its files are
      // neither decoded nor stored again.
      const earlier = b.request_id ? await findTicketByRequestId(db, b.request_id) : null;
      if (earlier) return reply.code(200).send(intakeAnswer(earlier));
      const decoded = decodeFiles(b.files);
      if (!decoded.ok) {
        return reply.code(400).send({ error: ErrorCodes.validationFailed, fields: decoded.fields });
      }
      const group = await findGroupByEgrantUrl(db, b.instance_url);
      // A deactivated client takes no tickets: eGrant hears it at once, nothing is stored.
      if (group?.deactivatedAt) {
        request.log.info({ groupId: group.id }, 'ticket intake: deactivated client');
        return reply.code(409).send({ error: ErrorCodes.groupInactive });
      }
      const groupId = group?.id ?? null;
      // The files are stored first, unattached; the ticket's transaction attaches them. Any
      // failure, or a concurrent duplicate, deletes them again (the daily unattached cleanup
      // is the net if even that fails).
      const fileIds: string[] = [];
      let result: Awaited<ReturnType<typeof createTicket>>;
      try {
        for (const file of decoded.files) {
          fileIds.push((await createReceivedFile(deps, { groupId, ...file })).id);
        }
        result = await createTicket(
          deps,
          {
            source: 'api',
            groupId,
            createdBy: null,
            fields: {
              area: b.area,
              subject: b.subject,
              programme: b.programme,
              body: b.body,
              dueDate: b.due_date,
              url: b.url,
            },
            requester: { email: b.email, name: b.requester_name, phone: b.phone },
            // Kept as received, so admins see what eGrant sent even when no client matched.
            instanceUrl: b.instance_url,
            requestId: b.request_id,
            receivedFileIds: fileIds,
            // Phase 33 part P3: eGrant's `project_id` links the ticket to its client's project.
            egrantProject: intakeProjectLink(config, b.project_id),
          },
          // eGrant signs as a system: the author is the instance (spec §2).
          egrantActor(
            'intake',
            group?.egrantUrl ??
              normalizeEgrantUrl(b.instance_url ?? '') ??
              b.instance_url ??
              'eGrant',
          ),
        );
      } catch (error) {
        await deleteFiles(deps, fileIds).catch(() => undefined);
        throw error;
      }
      const { ticket, notifyRequester, duplicate } = result;
      // A concurrent duplicate lost the race to the unique key: the winner does the rest.
      if (duplicate) {
        await deleteFiles(deps, fileIds).catch(() => undefined);
        return reply.code(200).send(intakeAnswer(ticket));
      }
      await afterCreate(request, ticket, notifyRequester);
      return reply.code(201).send(intakeAnswer(ticket));
    },
  );

  // ---- Manual creation ------------------------------------------------------------------------
  app.post('/tickets', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = TicketCreateBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const b = body.data;
    const target = await getGroup(db, b.groupId);
    if (!target) return notFound(reply);
    const role = await roleIn(db, actor, b.groupId);
    if (!isAdmin(actor) && role === null) return notFound(reply);
    if (!canCreateTicket(actor, role)) return send(reply, 403, ErrorCodes.forbidden);
    if (!canHoldTickets(target)) return send(reply, 400, ErrorCodes.invalidGroup);
    // A client is the initiator; an admin names one (or none).
    const requester = isAdmin(actor)
      ? { email: b.requesterEmail, name: b.requesterName, phone: b.requesterPhone }
      : { email: actor.email, name: actor.name, phone: b.requesterPhone };
    try {
      const { ticket, notifyRequester } = await createTicket(
        deps,
        {
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
          },
          requester,
          fileIds: b.fileIds,
          knowledgeIds: b.knowledgeIds,
          // Phase 33 part P2: a client creating a ticket may choose its project too (decision 8).
          project: { projectId: b.projectId ?? null, eventId: b.eventId ?? null },
        },
        auditActorOf(request),
      );
      await afterCreate(request, ticket, notifyRequester);
      // F16: the people the text names (after the commit: the ticket exists either way).
      await requestDelivery(deps.jobs, await recordTicketMentions(db, actor, ticket, null));
      return reply.code(201).send(await getTicketForActor(db, actor, ticket.id));
    } catch (error) {
      if (error instanceof InvalidAttachmentError)
        return send(reply, 400, ErrorCodes.invalidAttachment);
      if (error instanceof InvalidKnowledgeLinkError) {
        return send(reply, 400, ErrorCodes.invalidKnowledgeItem);
      }
      if (error instanceof InvalidTicketGroupError)
        return send(reply, 400, ErrorCodes.invalidGroup);
      if (error instanceof InvalidProjectError) return send(reply, 400, ErrorCodes.invalidProject);
      throw error;
    }
  });

  // ---- Lists ------------------------------------------------------------------------------------
  /**
   * Phase 33 part P2: where the Project and Event filters apply. A group tab takes both (an event
   * under a project); the global list a project only with exactly one client; the initiator's
   * own list neither.
   */
  type ListKind = 'group' | 'global' | 'mine';
  const projectFilterFits = (
    kind: ListKind,
    query: ReturnType<typeof TicketListQuerySchema.parse>,
  ) =>
    kind === 'group'
      ? isValidProjectFilter(query)
      : kind === 'global'
        ? isValidGlobalProjectFilter(query, query.clients)
        : query.project === undefined && query.event === undefined;

  const listOr400 = async (
    reply: FastifyReply,
    run: (query: ReturnType<typeof TicketListQuerySchema.parse>) => Promise<unknown>,
    raw: unknown,
    kind: ListKind,
  ) => {
    const query = TicketListQuerySchema.safeParse(raw);
    if (!query.success) return send(reply, 400, 'invalid_filter');
    if (!projectFilterFits(kind, query.data)) return send(reply, 400, 'invalid_filter');
    try {
      return await run(query.data);
    } catch (error) {
      if (error instanceof InvalidTicketCursorError) return send(reply, 400, 'invalid_filter');
      throw error;
    }
  };

  app.get('/tickets/global', { preHandler: adminOnly }, async (request, reply) =>
    listOr400(
      reply,
      (q) => listTickets(db, request.user!, { kind: 'global' }, q),
      request.query,
      'global',
    ),
  );

  app.get('/tickets/mine', { preHandler: anyUser }, async (request, reply) =>
    listOr400(
      reply,
      (q) => listTickets(db, request.user!, { kind: 'mine' }, q),
      request.query,
      'mine',
    ),
  );

  app.get<IdParams>('/groups/:id/tickets', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const groupId = request.params.id;
    const role = await roleIn(db, actor, groupId);
    const group = isAdmin(actor) || role !== null ? await getGroup(db, groupId) : null;
    // The admin group has no Tickets tab (Phase 34).
    if (!group || !canHoldTickets(group)) return notFound(reply);
    return listOr400(
      reply,
      (q) => listTickets(db, actor, { kind: 'group', groupId, role }, q),
      request.query,
      'group',
    );
  });

  /**
   * After a write changed time entries (Phase 32): delivers the time requests, tells the finance
   * room and the users whose requests changed. A failure is logged; the write succeeded.
   */
  const announceTime = async (request: FastifyRequest, time: TimeChange) => {
    try {
      await requestDelivery(jobs, time.eventIds);
      await announceTimeChange(db, app.io, time);
    } catch (error) {
      request.log.error({ err: error }, 'could not announce a time change');
    }
  };

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

  // 2026-10-17: the viewer opened the ticket's page: its changes so far are seen.
  // 2026-10-19 (ADR 0060): and their notification centre items about it are read.
  app.post<IdParams>('/tickets/:id/seen', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const row = await readable(actor, request.params.id, reply);
    if (!row) return reply;
    await markTicketSeen(db, actor.id, row.id);
    emitSeen(app.io, actor.id, { kind: 'ticket', id: row.id, groupId: row.groupId });
    await readSubject(db, app.io, actor.id, { kind: 'ticket', id: row.id });
    return reply.code(204).send();
  });

  // 2026-10-18: what changed since the viewer last opened the ticket: their own events only, and
  // only while they read it now (a ticket moved to another client is gone for its old one).
  app.get<IdParams>(
    '/tickets/:id/unseen-summary',
    { preHandler: anyUser },
    async (request, reply): Promise<UnseenSummary | FastifyReply> => {
      const actor = request.user!;
      const row = await readable(actor, request.params.id, reply);
      if (!row) return reply;
      return ticketUnseenSummary(db, actor.id, row.id);
    },
  );

  app.patch<IdParams>('/tickets/:id', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readable(actor, request.params.id, reply))) return reply;
    if (!canEditTicket(actor)) return send(reply, 403, ErrorCodes.forbidden);
    const body = TicketPatchBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    let result;
    try {
      result = await updateTicket(db, request.params.id, body.data, actor, auditActorOf(request));
    } catch (error) {
      if (!(error instanceof InvalidKnowledgeLinkError)) throw error;
      return send(reply, 400, ErrorCodes.invalidKnowledgeItem);
    }
    if (!result) return notFound(reply);
    const { ticket, statusChanged, fieldsChanged, askTime, time, mentionEventIds } = result;
    await requestDelivery(deps.jobs, mentionEventIds);
    if (statusChanged || fieldsChanged) {
      emitTicket(app.io, 'updated', ticket);
      const change = { ticket, actorId: actor.id };
      if (statusChanged) await runTicketChange(deps, { ...change, kind: 'status' }, request.log);
      if (fieldsChanged) await runTicketChange(deps, { ...change, kind: 'updated' }, request.log);
      await announceTime(request, time);
    }
    return { ...(await getTicketForActor(db, actor, ticket.id)), askTime };
  });

  app.put<IdParams>('/tickets/:id/group', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await readable(actor, request.params.id, reply))) return reply;
    if (!canEditTicket(actor)) return send(reply, 403, ErrorCodes.forbidden);
    const body = TicketGroupBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const target = await getGroup(db, body.data.groupId);
    if (!target) return notFound(reply);
    if (!canHoldTickets(target)) return send(reply, 400, ErrorCodes.invalidGroup);
    try {
      const result = await assignTicketGroup(
        db,
        request.params.id,
        body.data.groupId,
        auditActorOf(request),
      );
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

  // ---- Project and event (Phase 33 part P2) -----------------------------------------------------
  // A route of its own, so the group's clients set them without editing the ticket's other
  // fields (decision 8). A žiadateľ never writes to the group: 404, like every project route.
  app.put<IdParams>('/tickets/:id/project', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = TicketProjectBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const row = await readable(actor, request.params.id, reply);
    if (!row) return reply;
    if (row.groupId === null) return send(reply, 409, ErrorCodes.noClient);
    if (!canSetTicketProject(actor, row, await roleIn(db, actor, row.groupId))) {
      return notFound(reply);
    }
    let result;
    try {
      result = await setTicketProject(
        db,
        { ...row, groupId: row.groupId },
        body.data,
        auditActorOf(request),
      );
    } catch (error) {
      if (error instanceof InvalidProjectError) return send(reply, 400, ErrorCodes.invalidProject);
      throw error;
    }
    if (!result) return notFound(reply); // moved to another client meanwhile
    // No hook: a project change notifies nobody (decision 26); open views refetch.
    if (result.changed) emitTicket(app.io, 'updated', result.ticket);
    if (result.entriesMoved) emitFinanceChanged(app.io, row.groupId, 'time');
    return getTicketForActor(db, actor, row.id);
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

  // ---- Riešitelia (assignees) ----------------------------------------------------------------------
  /** The ticket if the actor reads it and may change its riešitelia, else a 404 or 403 sent. */
  const assignable = async (actor: SessionUser, id: string, reply: FastifyReply) => {
    const row = await readable(actor, id, reply);
    if (!row) return null;
    if (!canAssignTicket(actor, row, await roleIn(db, actor, row.groupId))) {
      send(reply, 403, ErrorCodes.forbidden);
      return null;
    }
    return row;
  };

  app.get<IdParams>(
    '/tickets/:id/assignee-candidates',
    { preHandler: anyUser },
    async (request, reply) => {
      const row = await assignable(request.user!, request.params.id, reply);
      if (!row) return reply;
      return assigneeCandidates(db, row);
    },
  );

  type AssigneeParams = { Params: { id: string; userId: string } };

  app.put<AssigneeParams>(
    '/tickets/:id/assignees/:userId',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
      const row = await assignable(actor, request.params.id, reply);
      if (!row) return reply;
      try {
        const added = await addAssignee(db, row, request.params.userId, auditActorOf(request));
        if (added) {
          emitTicket(app.io, 'updated', row);
          await runTicketChange(
            deps,
            { kind: 'assigned', ticket: row, actorId: actor.id, assigneeId: request.params.userId },
            request.log,
          );
        }
      } catch (error) {
        if (error instanceof InvalidTicketAssigneeError) {
          return send(reply, 400, ErrorCodes.invalidAssignee);
        }
        throw error;
      }
      return getTicketForActor(db, actor, row.id);
    },
  );

  app.delete<AssigneeParams>(
    '/tickets/:id/assignees/:userId',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      if (!allowWrite(actor.id)) return send(reply, 429, ErrorCodes.rateLimited);
      const row = await assignable(actor, request.params.id, reply);
      if (!row) return reply;
      if (await removeAssignee(db, row.id, request.params.userId, auditActorOf(request))) {
        emitTicket(app.io, 'updated', row);
        // Their time request went with them (Phase 32).
        await announceTime(request, {
          groupId: row.groupId,
          changed: true,
          users: [request.params.userId],
          eventIds: [],
        });
      }
      return getTicketForActor(db, actor, row.id);
    },
  );

  // ---- Watch tickets (per user and client group) ------------------------------------------------
  /** The actor's role in the group if they may watch its tickets, else a 404 or 403 sent. */
  const watchable = async (actor: SessionUser, groupId: string, reply: FastifyReply) => {
    const role = await roleIn(db, actor, groupId);
    const group = isAdmin(actor) || role !== null ? await getGroup(db, groupId) : null;
    // "Watch tickets" does not apply to the admin group (Phase 34).
    if (!group || !canHoldTickets(group)) {
      notFound(reply);
      return false;
    }
    if (!canWatchTickets(actor, role)) {
      send(reply, 403, ErrorCodes.forbidden);
      return false;
    }
    return true;
  };

  app.get<IdParams>('/groups/:id/ticket-watch', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    if (!(await watchable(actor, request.params.id, reply))) return reply;
    return { watching: await watchesTickets(db, actor, request.params.id) };
  });

  app.put<IdParams>('/groups/:id/ticket-watch', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    const body = TicketWatchSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    if (!(await watchable(actor, request.params.id, reply))) return reply;
    await setTicketWatch(db, actor.id, request.params.id, body.data.watching);
    return { watching: body.data.watching };
  });
};
