import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  CONTRACTS_PAGE_SIZE,
  ContractsQuerySchema,
  ErrorCodes,
  HoursRankingQuerySchema,
  OVERVIEW_MAX_MONTHS,
  OverviewQuerySchema,
  PaidRankingQuerySchema,
  SystemClientsQuerySchema,
  WorkLogQuerySchema,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { adminGroupId } from '../groups/admin-group.js';
import { dataMonthRange, overview } from './aggregates.js';
import { InvalidCursorError, listContracts } from './documents.js';
import { hoursRanking, paidRange, paidRanking, RankingCursorError } from './rankings.js';
import { canSeeExpenses } from './policy.js';
import { monthsOf, scopeOfClients, withoutGroup } from './scope.js';
import { WorkLogCursorError, workLogPage } from './work-log.js';

const invalidFilter = (reply: FastifyReply) =>
  reply.code(400).send({ error: ErrorCodes.invalidFilter });

/** A malformed cursor is a bad filter (400); anything else is rethrown (500). */
function cursorError(reply: FastifyReply, error: unknown): FastifyReply {
  if (
    error instanceof WorkLogCursorError ||
    error instanceof RankingCursorError ||
    error instanceof InvalidCursorError
  ) {
    return invalidFilter(reply);
  }
  throw error;
}

/**
 * The system-wide page `/finance` and its rankings (Phase 32 part D, spec §6.2, §7). Registered
 * by `routes.ts` inside `requireFinance`, so every handler runs for a finance admin only. Each
 * takes the page's `clients=` filter (none: every client, which also covers the time without a
 * client, owner decision 24); a malformed filter or cursor answers `400 invalid_filter`. They
 * reuse parts B and C: `overview`, `workLogPage`, `listContracts` with a `groups` or `all` scope.
 * The admin group "eGrant tím" (Phase 34 part E) is in only when chosen (`clients=` names it, or
 * `internal=1`), and the rankings never hold it (`withoutGroup`).
 *   GET /api/finance/overview?clients=&from=&to=
 *   GET /api/finance/work-log?clients=&from=&to=&before=
 *   GET /api/finance/contracts?clients=&sort=&dir=&q=&from=&to=&after=
 *   GET /api/finance/rankings/paid?from=&to=&currency=&clients=&after= (or year=&month=)
 *   GET /api/finance/rankings/hours?from=&to=&admin=&sort=&clients=&after=
 */
export const financeSystemRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db } },
) => {
  /** The page's scope: the chosen clients, the admin group only when chosen. */
  const scopeOf = async (clients: readonly string[], internal: boolean) =>
    scopeOfClients(clients, { id: await adminGroupId(db), internal });

  app.get('/finance/overview', async (request, reply) => {
    const clients = SystemClientsQuerySchema.safeParse(request.query);
    const query = OverviewQuerySchema.safeParse(request.query);
    if (!clients.success || !query.success) return invalidFilter(reply);
    const scope = await scopeOf(clients.data.clients, clients.data.internal);
    // Every client chosen: the organisation's expenses count too (Phase 32 E, decision O3).
    const organisation = scope.kind === 'all' && canSeeExpenses(request.user!);
    const { from, to } = query.data;
    const range =
      from && to ? { from, to } : await dataMonthRange(db, scope, new Date(), organisation);
    if (monthsOf(range).length > OVERVIEW_MAX_MONTHS) return invalidFilter(reply);
    return overview(db, scope, range, new Date(), { organisation });
  });

  app.get('/finance/work-log', async (request, reply) => {
    const clients = SystemClientsQuerySchema.safeParse(request.query);
    const query = WorkLogQuerySchema.safeParse(request.query);
    if (!clients.success || !query.success) return invalidFilter(reply);
    const { from, to, before } = query.data;
    try {
      return await workLogPage(
        db,
        await scopeOf(clients.data.clients, clients.data.internal),
        from && to ? { from, to } : null,
        before ?? null,
      );
    } catch (error) {
      return cursorError(reply, error);
    }
  });

  app.get('/finance/contracts', async (request, reply) => {
    const query = ContractsQuerySchema.safeParse(request.query);
    if (!query.success) return invalidFilter(reply);
    const { clients, internal, type, sort, dir, q, after, from, to } = query.data;
    // Without a search the kinds of `type` (Phase 32 E, decisions E12, E16): contracts and
    // expenses of the page period, when one is given; documents, notes and every kind with no
    // period. A search covers every finance item, whatever the period and the type.
    const dated = type === 'contract' || type === 'expense';
    try {
      return await listContracts(db, await scopeOf(clients, internal), {
        ...(q
          ? { q }
          : {
              ...(type === 'all' ? {} : { type }),
              ...(dated && from && to ? { period: { from, to } } : {}),
            }),
        sort,
        dir,
        ...(after ? { after } : {}),
        limit: CONTRACTS_PAGE_SIZE,
      });
    } catch (error) {
      return cursorError(reply, error);
    }
  });

  app.get('/finance/rankings/paid', async (request, reply) => {
    const query = PaidRankingQuerySchema.safeParse(request.query);
    if (!query.success) return invalidFilter(reply);
    const { clients, from, to, year, month, currency, after } = query.data;
    const range =
      year !== undefined
        ? paidRange({ year, ...(month ? { month } : {}) })
        : from && to
          ? { from, to }
          : null;
    try {
      return await paidRanking(db, withoutGroup(scopeOfClients(clients), await adminGroupId(db)), {
        range,
        currency,
        ...(after ? { after } : {}),
      });
    } catch (error) {
      return cursorError(reply, error);
    }
  });

  app.get('/finance/rankings/hours', async (request, reply) => {
    const query = HoursRankingQuerySchema.safeParse(request.query);
    if (!query.success) return invalidFilter(reply);
    const { clients, from, to, admin, sort, after } = query.data;
    const range = from && to ? { from, to } : null;
    if (range && monthsOf(range).length > OVERVIEW_MAX_MONTHS) return invalidFilter(reply);
    try {
      return await hoursRanking(db, withoutGroup(scopeOfClients(clients), await adminGroupId(db)), {
        range,
        sort,
        ...(admin ? { admin } : {}),
        ...(after ? { after } : {}),
      });
    } catch (error) {
      return cursorError(reply, error);
    }
  });
};
