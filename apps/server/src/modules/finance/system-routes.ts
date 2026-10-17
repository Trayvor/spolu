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
import { dataMonthRange, overview } from './aggregates.js';
import { InvalidCursorError, listContracts } from './documents.js';
import { hoursRanking, paidRanking, RankingCursorError } from './rankings.js';
import { monthsOf, scopeOfClients } from './scope.js';
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
 *   GET /api/finance/overview?clients=&from=&to=
 *   GET /api/finance/work-log?clients=&from=&to=&before=
 *   GET /api/finance/contracts?clients=&sort=&dir=&q=&after=
 *   GET /api/finance/rankings/paid?year=&month=&currency=&clients=&after=
 *   GET /api/finance/rankings/hours?from=&to=&admin=&sort=&clients=&after=
 */
export const financeSystemRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db } },
) => {
  app.get('/finance/overview', async (request, reply) => {
    const clients = SystemClientsQuerySchema.safeParse(request.query);
    const query = OverviewQuerySchema.safeParse(request.query);
    if (!clients.success || !query.success) return invalidFilter(reply);
    const scope = scopeOfClients(clients.data.clients);
    const { from, to } = query.data;
    const range = from && to ? { from, to } : await dataMonthRange(db, scope);
    if (monthsOf(range).length > OVERVIEW_MAX_MONTHS) return invalidFilter(reply);
    return overview(db, scope, range);
  });

  app.get('/finance/work-log', async (request, reply) => {
    const clients = SystemClientsQuerySchema.safeParse(request.query);
    const query = WorkLogQuerySchema.safeParse(request.query);
    if (!clients.success || !query.success) return invalidFilter(reply);
    const { from, to, before } = query.data;
    try {
      return await workLogPage(
        db,
        scopeOfClients(clients.data.clients),
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
    const { clients, sort, dir, q, after } = query.data;
    try {
      // Without a search only contracts; a search covers every finance document and note too.
      return await listContracts(db, scopeOfClients(clients), {
        ...(q ? { q } : { type: 'contract' }),
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
    const { clients, year, month, currency, after } = query.data;
    try {
      return await paidRanking(db, scopeOfClients(clients), {
        year,
        ...(month ? { month } : {}),
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
    if (monthsOf({ from, to }).length > OVERVIEW_MAX_MONTHS) return invalidFilter(reply);
    try {
      return await hoursRanking(db, scopeOfClients(clients), {
        range: { from, to },
        sort,
        ...(admin ? { admin } : {}),
        ...(after ? { after } : {}),
      });
    } catch (error) {
      return cursorError(reply, error);
    }
  });
};
