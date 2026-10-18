import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  CONTRACTS_PAGE_SIZE,
  ContractsQuerySchema,
  ErrorCodes,
  FinanceProjectQuerySchema,
  HoursRankingQuerySchema,
  isValidSystemProjectFilter,
  OVERVIEW_MAX_MONTHS,
  OverviewQuerySchema,
  PaidRankingQuerySchema,
  type ProjectFilter,
  SystemClientsQuerySchema,
  WorkLogQuerySchema,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { adminGroupId } from '../groups/admin-group.js';
import { dataMonthRange, overview } from './aggregates.js';
import { InvalidCursorError, listContracts } from './documents.js';
import { hoursRanking, paidRange, paidRanking, RankingCursorError } from './rankings.js';
import { canSeeExpenses } from './policy.js';
import { type FinanceScope, monthsOf, scopeOfClients, withoutGroup } from './scope.js';
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
 * The admin group "eGrant tím" (Phase 34 part E) is in "every client" unless `internal=0` (owner
 * decision of 2026-10-18), among chosen clients when `clients=` names it, and the rankings never
 * hold it (`withoutGroup`): it is no client, and its hours stay in the overview and work log.
 *   GET /api/finance/overview?clients=&internal=&from=&to=&project=
 *   GET /api/finance/work-log?clients=&internal=&from=&to=&before=&project=
 * (`project` only with exactly one client, never `event`: Phase 33 P6, decision 24; the admin
 * group does not count as a client there, and a project narrows the scope to that one client,
 * so the team's time drops out (decision of the P6 / P34-E rebase, 2026-10-18). The rankings
 * and the contracts list take no project.)
 *   GET /api/finance/contracts?clients=&sort=&dir=&q=&from=&to=&after=
 *   GET /api/finance/rankings/paid?from=&to=&currency=&clients=&after= (or year=&month=)
 *   GET /api/finance/rankings/hours?from=&to=&admin=&sort=&clients=&after=
 */
export const financeSystemRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db } },
) => {
  /**
   * The page's scope and Project filter (Phase 33 P6, decision 24, with Phase 34 part E): the
   * chosen clients, the admin group only when chosen (or in "every client" unless `internal=0`).
   * A `project` needs exactly one client group chosen, the admin group not counted (it is ticked
   * by default and holds no client's projects), and never an event; with one, the scope is that
   * client alone (as if `clients=` named it alone), because the filter is that client's projects.
   * Null when the query is not valid (400 `invalid_filter`).
   */
  const scopeAndProjectOf = async (
    query: unknown,
    clients: readonly string[],
    internal: boolean,
  ): Promise<{ scope: FinanceScope; project: ProjectFilter } | null> => {
    const project = FinanceProjectQuerySchema.safeParse(query);
    if (!project.success) return null;
    const adminId = await adminGroupId(db);
    const clientGroups = clients.filter((id) => id !== adminId);
    if (!isValidSystemProjectFilter(project.data, clientGroups)) return null;
    if (project.data.project !== undefined) {
      return { scope: scopeOfClients(clientGroups), project: project.data };
    }
    return { scope: scopeOfClients(clients, { id: adminId, internal }), project: project.data };
  };

  app.get('/finance/overview', async (request, reply) => {
    const clients = SystemClientsQuerySchema.safeParse(request.query);
    const query = OverviewQuerySchema.safeParse(request.query);
    if (!clients.success || !query.success) return invalidFilter(reply);
    const filtered = await scopeAndProjectOf(
      request.query,
      clients.data.clients,
      clients.data.internal,
    );
    if (!filtered) return invalidFilter(reply);
    const { scope, project } = filtered;
    // Every client chosen: the organisation's expenses count too (Phase 32 E, decision O3).
    const organisation = scope.kind === 'all' && canSeeExpenses(request.user!);
    const { from, to } = query.data;
    const range =
      from && to ? { from, to } : await dataMonthRange(db, scope, new Date(), organisation);
    if (monthsOf(range).length > OVERVIEW_MAX_MONTHS) return invalidFilter(reply);
    return overview(db, scope, range, new Date(), { organisation, project });
  });

  app.get('/finance/work-log', async (request, reply) => {
    const clients = SystemClientsQuerySchema.safeParse(request.query);
    const query = WorkLogQuerySchema.safeParse(request.query);
    if (!clients.success || !query.success) return invalidFilter(reply);
    const filtered = await scopeAndProjectOf(
      request.query,
      clients.data.clients,
      clients.data.internal,
    );
    if (!filtered) return invalidFilter(reply);
    const { from, to, before } = query.data;
    try {
      return await workLogPage(
        db,
        filtered.scope,
        from && to ? { from, to } : null,
        before ?? null,
        filtered.project,
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
      return await listContracts(
        db,
        scopeOfClients(clients, { id: await adminGroupId(db), internal }),
        {
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
        },
      );
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
