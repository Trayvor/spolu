import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ErrorCodes,
  WeeklySummaryArchiveQuerySchema,
  WeeklySummaryErrors,
  WeeklySummaryListQuerySchema,
  WeeklySummaryPatchSchema,
  WeeklySummaryPreviewSchema,
  WeeklySummarySettingsSchema,
  WeeklySummaryVersionSchema,
  type SessionUser,
  type WeeklySummaryGroupSetting,
  type WeeklySummaryList,
  type WeeklySummaryPreviewResult,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin } from '../auth/session.js';
import { isGroupManager } from '../groups/managers.js';
import { clientGroupOptions, getGroup } from '../groups/service.js';
import { getNotificationProfiles } from '../users/service.js';
import { InvalidArchiveCursorError, listArchive } from './archive.js';
import { toDto, toListItems } from './dto.js';
import {
  NoRecipientsError,
  NotDraftError,
  RefsChangedError,
  StaleVersionError,
  SummaryGroupInactiveError,
} from './errors.js';
import { emitSummaryChanged } from './events.js';
import { WS_DRAFT_JOB } from './jobs.js';
import { canManageWeeklySummary, canReadWeeklySummaries } from './policy.js';
import { emailOf, sendSummary } from './send.js';
import {
  getGroupSetting,
  getSummary,
  InvalidSummaryCursorError,
  listRevisions,
  listSummaries,
  markRegenerating,
  olderDraftCount,
  restoreRevision,
  setGroupSetting,
  skipDraft,
  updateDraft,
  type SummaryRow,
} from './service.js';
import { isoWeek } from './week.js';

type IdParams = { Params: { id: string } };
const HOUR_MS = 60 * 60_000;
const PER_HOUR = 10;

/**
 * The review routes of the weekly client summary (spec 2026-10-19 §7): every admin reads the
 * list, a draft, its revisions, its preview and the archive (`canReadWeeklySummaries`); only the
 * group's manager (`canManageWeeklySummary`) edits, regenerates, restores, test-sends, sends,
 * skips or switches the group. Writes push `weekly-summary:changed` after the commit.
 */
export const weeklySummaryRoutes: FastifyPluginAsync<{ deps: AppDeps; now?: () => Date }> = async (
  app,
  { deps, now = () => new Date() },
) => {
  const { db, config } = deps;
  const adminOnly = requireAdmin(app.auth);
  const regenerateLimit = createRateLimiter({ windowMs: HOUR_MS, max: PER_HOUR });
  const testLimit = createRateLimiter({ windowMs: HOUR_MS, max: PER_HOUR });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
  const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: ErrorCodes.forbidden });
  const invalid = (reply: FastifyReply) =>
    reply.code(400).send({ error: ErrorCodes.validationFailed });

  /** The policy on top of `requireAdmin`. */
  const readable = (actor: SessionUser) => canReadWeeklySummaries(actor);

  async function dtoOf(row: SummaryRow, actor: SessionUser) {
    return toDto(db, row, await isGroupManager(db, row.groupId, actor.id));
  }

  /** The summary of `:id` and whether the actor manages its group; a sent 404 / 403 → null. */
  async function load(
    request: FastifyRequest<IdParams>,
    reply: FastifyReply,
    manage: boolean,
  ): Promise<SummaryRow | null> {
    const actor = request.user!;
    if (!readable(actor)) {
      await forbidden(reply);
      return null;
    }
    const row = await getSummary(db, request.params.id);
    if (!row) {
      await notFound(reply);
      return null;
    }
    if (manage && !canManageWeeklySummary(actor, await isGroupManager(db, row.groupId, actor.id))) {
      await forbidden(reply);
      return null;
    }
    return row;
  }

  /** The module's errors as answers; anything else is rethrown. */
  async function answerError(error: unknown, reply: FastifyReply, actor: SessionUser) {
    if (error instanceof StaleVersionError) {
      return reply
        .code(409)
        .send({
          error: WeeklySummaryErrors.staleVersion,
          current: await dtoOf(error.current, actor),
        });
    }
    if (error instanceof RefsChangedError) {
      return reply
        .code(409)
        .send({
          error: WeeklySummaryErrors.refsChanged,
          current: await dtoOf(error.current, actor),
        });
    }
    if (error instanceof NotDraftError) {
      return reply.code(409).send({ error: WeeklySummaryErrors.notDraft });
    }
    if (error instanceof NoRecipientsError) {
      return reply.code(409).send({ error: WeeklySummaryErrors.noRecipients });
    }
    if (error instanceof SummaryGroupInactiveError) {
      return reply.code(409).send({ error: ErrorCodes.groupInactive });
    }
    throw error;
  }

  app.get('/weekly-summaries', { preHandler: adminOnly }, async (request, reply) => {
    const actor = request.user!;
    if (!readable(actor)) return forbidden(reply);
    const query = WeeklySummaryListQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    const week = query.data.week ?? isoWeek(now());
    try {
      const page = await listSummaries(db, actor.id, { ...query.data, week });
      const [items, olderDrafts] = await Promise.all([
        toListItems(db, page.rows),
        olderDraftCount(db, page.managed, week),
      ]);
      const answer: WeeklySummaryList = { items, nextCursor: page.nextCursor, olderDrafts };
      return answer;
    } catch (error) {
      if (error instanceof InvalidSummaryCursorError) return invalid(reply);
      throw error;
    }
  });

  // Before `/:id`: the archive and the archive's client picker.
  app.get('/weekly-summaries/archive', { preHandler: adminOnly }, async (request, reply) => {
    if (!readable(request.user!)) return forbidden(reply);
    const query = WeeklySummaryArchiveQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    if (query.data.groupId) {
      const group = await getGroup(db, query.data.groupId);
      if (!group || group.kind !== 'client') return notFound(reply);
    }
    try {
      return await listArchive(db, query.data);
    } catch (error) {
      if (error instanceof InvalidArchiveCursorError) return invalid(reply);
      throw error;
    }
  });

  const GroupsQuery = z.object({ q: z.string().trim().max(100).optional() });
  app.get('/weekly-summaries/groups', { preHandler: adminOnly }, async (request, reply) => {
    if (!readable(request.user!)) return forbidden(reply);
    const query = GroupsQuery.safeParse(request.query);
    if (!query.success) return invalid(reply);
    return { items: await clientGroupOptions(db, { q: query.data.q || undefined, limit: 20 }) };
  });

  app.get<IdParams>('/weekly-summaries/:id', { preHandler: adminOnly }, async (request, reply) => {
    const row = await load(request, reply, false);
    if (!row) return reply;
    return dtoOf(row, request.user!);
  });

  app.patch<IdParams>(
    '/weekly-summaries/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummaryPatchSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const row = await load(request, reply, true);
      if (!row) return reply;
      const actor = request.user!;
      try {
        const { version, content, language } = body.data;
        const updated = await updateDraft(db, row.id, version, content, language, actor.id);
        if (!updated) return notFound(reply);
        emitSummaryChanged(app.io, updated);
        return await dtoOf(updated, actor);
      } catch (error) {
        return answerError(error, reply, actor);
      }
    },
  );

  app.post<IdParams>(
    '/weekly-summaries/:id/regenerate',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummaryVersionSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const row = await load(request, reply, true);
      if (!row) return reply;
      const actor = request.user!;
      if (!regenerateLimit(actor.id)) {
        return reply.code(429).send({ error: ErrorCodes.rateLimited });
      }
      try {
        const updated = await markRegenerating(
          db,
          row.id,
          body.data.version,
          body.data.language,
          actor.id,
        );
        if (!updated) return notFound(reply);
        emitSummaryChanged(app.io, updated);
        await deps.jobs.send(WS_DRAFT_JOB, { summaryId: updated.id });
        return reply.code(202).send({ status: 'preparing', version: updated.version });
      } catch (error) {
        return answerError(error, reply, actor);
      }
    },
  );

  app.get<IdParams>(
    '/weekly-summaries/:id/revisions',
    { preHandler: adminOnly },
    async (request, reply) => {
      const row = await load(request, reply, false);
      if (!row) return reply;
      return { items: await listRevisions(db, row.id) };
    },
  );

  app.post<{ Params: { id: string; revisionId: string } }>(
    '/weekly-summaries/:id/revisions/:revisionId/restore',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummaryVersionSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const row = await load(request, reply, true);
      if (!row) return reply;
      const actor = request.user!;
      try {
        const updated = await restoreRevision(
          db,
          row.id,
          request.params.revisionId,
          body.data.version,
          actor.id,
        );
        if (!updated) return notFound(reply);
        emitSummaryChanged(app.io, updated);
        return await dtoOf(updated, actor);
      } catch (error) {
        return answerError(error, reply, actor);
      }
    },
  );

  app.post<IdParams>(
    '/weekly-summaries/:id/preview',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummaryPreviewSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const row = await load(request, reply, false);
      if (!row) return reply;
      const group = await getGroup(db, row.groupId);
      // The unsubscribe link of a preview is a dummy: its person does not exist.
      const email = emailOf(config, row, group?.name ?? '', {
        userId: 'preview',
        email: 'preview@invalid',
        language: body.data.language,
      });
      const answer: WeeklySummaryPreviewResult = {
        subject: email.subject,
        html: email.html,
        text: email.text,
      };
      return answer;
    },
  );

  app.post<IdParams>(
    '/weekly-summaries/:id/test',
    { preHandler: adminOnly },
    async (request, reply) => {
      const row = await load(request, reply, true);
      if (!row) return reply;
      const actor = request.user!;
      if (!testLimit(actor.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
      const [group, profiles] = await Promise.all([
        getGroup(db, row.groupId),
        getNotificationProfiles(db, [actor.id]),
      ]);
      const me = profiles.get(actor.id);
      if (!me) return notFound(reply);
      // Only to the acting admin's own address, with a dummy unsubscribe link.
      await sendEmailLater(
        deps.jobs,
        emailOf(
          config,
          row,
          group?.name ?? '',
          { userId: 'preview', email: me.email, language: me.language },
          true,
        ),
      );
      return reply.code(204).send();
    },
  );

  app.post<IdParams>(
    '/weekly-summaries/:id/send',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummaryVersionSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const row = await load(request, reply, true);
      if (!row) return reply;
      const actor = request.user!;
      try {
        const result = await sendSummary(
          { db, config, jobs: deps.jobs, io: app.io },
          actor.id,
          row.id,
          body.data.version,
        );
        if (!result) return notFound(reply);
        return reply.code(202).send(result);
      } catch (error) {
        return answerError(error, reply, actor);
      }
    },
  );

  app.post<IdParams>(
    '/weekly-summaries/:id/skip',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummaryVersionSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const row = await load(request, reply, true);
      if (!row) return reply;
      const actor = request.user!;
      try {
        const updated = await skipDraft(db, row.id, body.data.version, actor.id);
        if (!updated) return notFound(reply);
        emitSummaryChanged(app.io, updated);
        return await dtoOf(updated, actor);
      } catch (error) {
        return answerError(error, reply, actor);
      }
    },
  );

  /** A client group of `:id`, or a sent 404. */
  async function clientGroup(id: string, reply: FastifyReply) {
    const group = id.length <= 100 ? await getGroup(db, id) : null;
    if (!group || group.kind !== 'client') {
      await notFound(reply);
      return null;
    }
    return group;
  }

  app.get<IdParams>(
    '/groups/:id/weekly-summary/settings',
    { preHandler: adminOnly },
    async (request, reply) => {
      const actor = request.user!;
      if (!readable(actor)) return forbidden(reply);
      const group = await clientGroup(request.params.id, reply);
      if (!group) return reply;
      const [enabled, manages] = await Promise.all([
        getGroupSetting(db, group.id),
        isGroupManager(db, group.id, actor.id),
      ]);
      const answer: WeeklySummaryGroupSetting = {
        enabled,
        canEdit: canManageWeeklySummary(actor, manages),
      };
      return answer;
    },
  );

  app.put<IdParams>(
    '/groups/:id/weekly-summary/settings',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = WeeklySummarySettingsSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      const actor = request.user!;
      const group = await clientGroup(request.params.id, reply);
      if (!group) return reply;
      if (!canManageWeeklySummary(actor, await isGroupManager(db, group.id, actor.id))) {
        return forbidden(reply);
      }
      await setGroupSetting(db, group.id, body.data.enabled, actor.id);
      return { enabled: body.data.enabled };
    },
  );
};
