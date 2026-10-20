import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  ErrorCodes,
  TeamsCheckBodySchema,
  TeamsConnectBodySchema,
  TeamsCreateBodySchema,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { knowledgeError } from '../knowledge/routes.js';
import {
  TeamsInvalidLinkError,
  TeamsLinkedError,
  TeamsMeetingLinkedError,
  TeamsMeetingNotFoundError,
  TeamsNotOrganizerError,
  TeamsOutsideTenantError,
  TeamsUnavailableError,
  TeamsUnknownOrganizerError,
} from './errors.js';
import { GraphError } from './graph-client.js';
import { canUseTeams } from './policy.js';
import {
  connectTeamsMeeting,
  createTeamsMeeting,
  disconnectTeamsMeeting,
  inviteeOptions,
  stopTeamsSeries,
  teamsState,
  type TeamsDeps,
} from './service.js';
import { TEAMS_SERIES_JOB } from './series.js';
import { checkTeamsMeeting } from './transcripts.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

function teamsError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof TeamsNotOrganizerError)
    return send(reply, 403, ErrorCodes.teamsNotOrganizer);
  if (error instanceof TeamsInvalidLinkError) return send(reply, 400, ErrorCodes.teamsInvalidLink);
  if (error instanceof TeamsOutsideTenantError) {
    return send(reply, 400, ErrorCodes.teamsOutsideTenant);
  }
  if (error instanceof TeamsUnknownOrganizerError) {
    return send(reply, 400, ErrorCodes.teamsUnknownOrganizer);
  }
  if (error instanceof TeamsMeetingNotFoundError) {
    return send(reply, 404, ErrorCodes.teamsMeetingNotFound);
  }
  if (error instanceof TeamsLinkedError) return send(reply, 409, ErrorCodes.teamsLinked);
  if (error instanceof TeamsMeetingLinkedError) {
    return send(reply, 409, ErrorCodes.teamsMeetingLinked);
  }
  // A Graph failure no service turned into its own error, a network error or a timeout too.
  if (error instanceof TeamsUnavailableError || error instanceof GraphError) {
    reply.log.warn({ code: error.code }, 'teams: Microsoft Graph failed');
    return send(reply, 502, ErrorCodes.teamsUnavailable);
  }
  return knowledgeError(reply, error);
}

/**
 * Teams T1: the Teams block of a knowledge meeting. Admins only, and only while Teams is
 * configured: for everyone else every route answers 404, as if it did not exist. MCP reaches
 * the reads and the create (2026-10-21, owner: every feature has MCP tools).
 */
export const teamsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const anyUser = requireUser(app.auth);
  const allowCreate = createRateLimiter({ windowMs: 60 * 60_000, max: 30 });
  const allowConnect = createRateLimiter({ windowMs: 60 * 60_000, max: 30 });
  const allowCheck = createRateLimiter({ windowMs: 60 * 60_000, max: 60 });

  /** The Teams deps for an allowed actor, or a sent 404 (then null). */
  function gate(actor: SessionUser, reply: FastifyReply): TeamsDeps | null {
    const graph = deps.teams;
    if (!graph || !canUseTeams(actor, deps.config.teams !== null)) {
      void send(reply, 404, ErrorCodes.notFound);
      return null;
    }
    return { db: deps.db, config: deps.config, graph };
  }
  const limited = (reply: FastifyReply) => send(reply, 429, ErrorCodes.rateLimited);

  app.get<IdParams>('/knowledge/:id/teams', { preHandler: anyUser }, async (request, reply) => {
    const teams = gate(request.user!, reply);
    if (!teams) return reply;
    try {
      return await teamsState(teams, request.user!, request.params.id);
    } catch (error) {
      return teamsError(reply, error);
    }
  });

  app.get<IdParams>(
    '/knowledge/:id/teams/people',
    { preHandler: anyUser },
    async (request, reply) => {
      const teams = gate(request.user!, reply);
      if (!teams) return reply;
      try {
        return await inviteeOptions(teams, request.user!, request.params.id);
      } catch (error) {
        return teamsError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/knowledge/:id/teams/meeting',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      const teams = gate(actor, reply);
      if (!teams) return reply;
      const body = TeamsCreateBodySchema.safeParse(request.body ?? {});
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      if (!allowCreate(actor.id)) return limited(reply);
      try {
        const state = await createTeamsMeeting(teams, actor, request.params.id, body.data);
        // ADR 0049: the later calls of the series get theirs now, not at the next tick.
        if (state.series?.planned) {
          await deps.jobs
            .send(TEAMS_SERIES_JOB, {})
            .catch((error: unknown) => request.log.warn({ err: error }, 'teams: series sync'));
        }
        return reply.code(201).send(state);
      } catch (error) {
        return teamsError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/knowledge/:id/teams/connect',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      const teams = gate(actor, reply);
      if (!teams) return reply;
      const body = TeamsConnectBodySchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      if (!allowConnect(actor.id)) return limited(reply);
      try {
        return await connectTeamsMeeting(teams, actor, request.params.id, body.data.url);
      } catch (error) {
        return teamsError(reply, error);
      }
    },
  );

  app.post<IdParams>(
    '/knowledge/:id/teams/check',
    { preHandler: anyUser },
    async (request, reply) => {
      const actor = request.user!;
      const teams = gate(actor, reply);
      if (!teams) return reply;
      const body = TeamsCheckBodySchema.safeParse(request.body ?? {});
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      if (!allowCheck(actor.id)) return limited(reply);
      try {
        return await checkTeamsMeeting(teams, actor, request.params.id, body.data);
      } catch (error) {
        return teamsError(reply, error);
      }
    },
  );

  // ADR 0049: "Stop for the following calls" of a series' Teams plan.
  app.delete<IdParams>(
    '/knowledge/:id/teams/series',
    { preHandler: anyUser },
    async (request, reply) => {
      const teams = gate(request.user!, reply);
      if (!teams) return reply;
      try {
        await stopTeamsSeries(teams, request.user!, request.params.id);
      } catch (error) {
        return teamsError(reply, error);
      }
      return reply.code(204).send();
    },
  );

  app.delete<IdParams>('/knowledge/:id/teams', { preHandler: anyUser }, async (request, reply) => {
    const teams = gate(request.user!, reply);
    if (!teams) return reply;
    try {
      await disconnectTeamsMeeting(teams, request.user!, request.params.id);
    } catch (error) {
      return teamsError(reply, error);
    }
    return reply.code(204).send();
  });
};
