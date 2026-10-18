import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  AddRateBodySchema,
  ErrorCodes,
  IdSchema,
  ManualEntryBodySchema,
  SystemManualEntryBodySchema,
  OVERVIEW_MAX_MONTHS,
  OverviewQuerySchema,
  TimeEntryPatchSchema,
  WorkLogQuerySchema,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { isAdminGroup } from '../groups/admin-group.js';
import { getGroup } from '../groups/service.js';
import { dataMonthRange, overview } from './aggregates.js';
import {
  createManualEntry,
  deleteTimeEntry,
  TimeEntryForbiddenError,
  TimeEntryInvalidError,
  TimeEntryNotFoundError,
  TimeEntryUserError,
  updateTimeEntry,
} from './manual-entries.js';
import {
  addRate,
  deleteRate,
  listRates,
  RateNotFoundError,
  RatesForbiddenError,
  RateUserError,
} from './rates.js';
import { canSeeExpenses } from './policy.js';
import { monthsOf } from './scope.js';
import { WorkLogCursorError, workLogPage } from './work-log.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/** Maps the expected service errors; anything else is rethrown (500). */
function logError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TimeEntryNotFoundError || error instanceof RateNotFoundError) {
    return send(reply, 404, ErrorCodes.notFound);
  }
  if (error instanceof TimeEntryForbiddenError || error instanceof RatesForbiddenError) {
    return send(reply, 403, ErrorCodes.forbidden);
  }
  if (error instanceof TimeEntryUserError || error instanceof RateUserError) {
    return send(reply, 400, ErrorCodes.invalidAssignee);
  }
  if (error instanceof TimeEntryInvalidError) return send(reply, 400, ErrorCodes.validationFailed);
  if (error instanceof WorkLogCursorError) return send(reply, 400, ErrorCodes.invalidFilter);
  throw error;
}

/**
 * Overview, work log, rates and manual entries (Phase 32 part C, spec §7). Registered by
 * `routes.ts` inside `requireFinance`, so every handler runs for a finance admin only (401 / 403
 * before). A client id that is unknown answers 404.
 *   GET  /api/groups/:id/finance/overview?from=&to=
 *   GET  /api/groups/:id/finance/work-log?from=&to=&before=
 *   POST /api/groups/:id/finance/time-entries · PATCH/DELETE /api/finance/time-entries/:id
 *   POST /api/finance/time-entries { groupId | null, … } ("Add time" on `/finance`)
 *   GET/POST /api/finance/rates · DELETE /api/finance/rates/:id
 */
export const financeLogRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db } },
) => {
  const io = () => app.io;

  /** The client of the path, or a 404 sent (null). */
  const groupOf = async (id: string, reply: FastifyReply) => {
    const group = IdSchema.safeParse(id).success ? await getGroup(db, id) : null;
    if (!group) void send(reply, 404, ErrorCodes.notFound);
    return group;
  };

  app.get<IdParams>('/groups/:id/finance/overview', async (request, reply) => {
    const query = OverviewQuerySchema.safeParse(request.query);
    if (!query.success) return send(reply, 400, ErrorCodes.invalidFilter);
    const group = await groupOf(request.params.id, reply);
    if (!group) return reply;
    const scope = { kind: 'group', groupId: group.id } as const;
    // The admin group's tab is the organisation's (Phase 34 part E): its internal time and the
    // organisation's expenses; a client's tab never has expenses (decision O3).
    const organisation = isAdminGroup(group) && canSeeExpenses(request.user!);
    const { from, to } = query.data;
    const range =
      from && to ? { from, to } : await dataMonthRange(db, scope, new Date(), organisation);
    if (monthsOf(range).length > OVERVIEW_MAX_MONTHS) {
      return send(reply, 400, ErrorCodes.invalidFilter);
    }
    return overview(db, scope, range, new Date(), { organisation });
  });

  app.get<IdParams>('/groups/:id/finance/work-log', async (request, reply) => {
    const query = WorkLogQuerySchema.safeParse(request.query);
    if (!query.success) return send(reply, 400, ErrorCodes.invalidFilter);
    const group = await groupOf(request.params.id, reply);
    if (!group) return reply;
    const { from, to, before } = query.data;
    try {
      return await workLogPage(
        db,
        { kind: 'group', groupId: group.id },
        from && to ? { from, to } : null,
        before ?? null,
      );
    } catch (error) {
      return logError(reply, error);
    }
  });

  app.post<IdParams>('/groups/:id/finance/time-entries', async (request, reply) => {
    const body = ManualEntryBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    try {
      const created = await createManualEntry(
        { db, io: io() },
        request.user!,
        request.params.id,
        body.data,
      );
      return reply.code(201).send(created);
    } catch (error) {
      return logError(reply, error);
    }
  });

  app.post('/finance/time-entries', async (request, reply) => {
    const body = SystemManualEntryBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    const { groupId, ...entry } = body.data;
    try {
      const created = await createManualEntry({ db, io: io() }, request.user!, groupId, entry);
      return reply.code(201).send(created);
    } catch (error) {
      return logError(reply, error);
    }
  });

  app.patch<IdParams>('/finance/time-entries/:id', async (request, reply) => {
    const patch = TimeEntryPatchSchema.safeParse(request.body);
    if (!patch.success) return send(reply, 400, ErrorCodes.validationFailed);
    try {
      await updateTimeEntry({ db, io: io() }, request.user!, request.params.id, patch.data);
      return reply.code(204).send();
    } catch (error) {
      return logError(reply, error);
    }
  });

  app.delete<IdParams>('/finance/time-entries/:id', async (request, reply) => {
    try {
      await deleteTimeEntry({ db, io: io() }, request.user!, request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return logError(reply, error);
    }
  });

  app.get('/finance/rates', async () => listRates(db));

  app.post('/finance/rates', async (request, reply) => {
    const body = AddRateBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    try {
      return reply.code(201).send(await addRate({ db, io: io() }, request.user!, body.data));
    } catch (error) {
      return logError(reply, error);
    }
  });

  app.delete<IdParams>('/finance/rates/:id', async (request, reply) => {
    try {
      await deleteRate({ db, io: io() }, request.user!, request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return logError(reply, error);
    }
  });
};
