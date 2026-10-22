import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  EgrantTicketAreasBodySchema,
  ErrorCodes,
  intakeFieldNames,
  TICKET_AREA_LIMITS,
  TicketAreaRulesBodySchema,
  type EgrantTicketAreasResponse,
  type TicketAreaRuleInput,
  type TicketAreaRules,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { egrantWebhookKey } from '../../infra/config/config.js';
import { bearerKeyMatches } from '../../infra/http/bearer-key.js';
import { egrantSignature } from '../../infra/http/egrant-signature.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { egrantActor } from '../audit/actor.js';
import { auditActorOf } from '../audit/request-actor.js';
import { requireUser } from '../auth/session.js';
import { egrantInstanceUrl, normalizeEgrantUrl } from '../groups/egrant-url.js';
import { findGroupsByEgrantUrl, getGroup } from '../groups/service.js';
import { listAdmins } from '../users/service.js';
import {
  InvalidAreaRuleError,
  listAreaCandidates,
  listAreaRules,
  replaceAreaRules,
} from './area-rules.js';
import { canHoldTickets, canManageTicketAreas } from './policy.js';
import { roleIn } from './service.js';

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * Automatic riešitelia by area (2026-10-21): the client's table for admins and, from 2026-10-22,
 * the group's clients (`GET`/`PUT /api/groups/:id/ticket-areas`, MCP calls the same routes; a
 * save replaces Help's rows), and eGrant's sync (`PUT /api/egrant/ticket-areas`,
 * docs/integrations/egrant.md, "Ticket areas"), which replaces eGrant's rows with its list.
 * eGrant uses the groups webhook's key and optional signing secret.
 */
export const ticketAreaRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const anyUser = requireUser(app.auth);
  const allowWrite = createRateLimiter({ windowMs: 60_000, max: 60 });

  /** The client group if the actor manages its table; else a 404 already sent. */
  const managed = async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
    const role = await roleIn(db, request.user!, request.params.id);
    if (!canManageTicketAreas(request.user!, role)) {
      send(reply, 404, ErrorCodes.notFound);
      return null;
    }
    const group = await getGroup(db, request.params.id);
    if (!group || !canHoldTickets(group)) {
      send(reply, 404, ErrorCodes.notFound);
      return null;
    }
    return group;
  };

  app.get<IdParams>(
    '/groups/:id/ticket-areas',
    { preHandler: anyUser },
    async (request, reply): Promise<TicketAreaRules | FastifyReply> => {
      const group = await managed(request, reply);
      if (!group) return reply;
      const [rules, candidates] = await Promise.all([
        listAreaRules(db, group.id),
        listAreaCandidates(db, group.id),
      ]);
      return { rules, candidates };
    },
  );

  app.put<IdParams>(
    '/groups/:id/ticket-areas',
    { preHandler: anyUser },
    async (request, reply): Promise<TicketAreaRules | FastifyReply> => {
      const group = await managed(request, reply);
      if (!group) return reply;
      if (!allowWrite(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
      const body = TicketAreaRulesBodySchema.safeParse(request.body);
      if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
      try {
        const { rules } = await replaceAreaRules(db, group, body.data.rules, auditActorOf(request));
        return { rules, candidates: await listAreaCandidates(db, group.id) };
      } catch (error) {
        if (error instanceof InvalidAreaRuleError) {
          return send(reply, 400, ErrorCodes.invalidAssignee);
        }
        throw error;
      }
    },
  );

  // ---- eGrant: the instance's whole table ------------------------------------------------------
  const allowEgrant = createRateLimiter({ windowMs: 60_000, max: 60 });
  const key = egrantWebhookKey(config, 'groups');
  // Checked before the body is read. The limit counts every call, so a wrong key is limited too.
  const gate = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!key) return send(reply, 503, ErrorCodes.intakeDisabled);
    if (!allowEgrant(request.ip)) return send(reply, 429, ErrorCodes.rateLimited);
    if (!bearerKeyMatches(request.headers.authorization, key)) {
      return send(reply, 401, ErrorCodes.unauthorized);
    }
  };

  app.put(
    '/egrant/ticket-areas',
    {
      onRequest: gate,
      bodyLimit: TICKET_AREA_LIMITS.bodyBytes,
      // Optional HMAC signature with the groups webhook's secret (EGRANT_GROUPS_SIGNING_SECRET).
      ...egrantSignature(config, 'groups'),
    },
    async (request, reply) => {
      const parsed = EgrantTicketAreasBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: ErrorCodes.validationFailed,
          fields: intakeFieldNames(parsed.error.issues),
        });
      }
      const url = normalizeEgrantUrl(egrantInstanceUrl(parsed.data.instance_url));
      if (!url) {
        return reply
          .code(400)
          .send({ error: ErrorCodes.validationFailed, fields: ['instance_url'] });
      }
      const found = await findGroupsByEgrantUrl(db, url, 2);
      if (found.length > 1) return send(reply, 409, ErrorCodes.ambiguousInstance);
      const group = found[0];
      if (!group || !canHoldTickets(group)) {
        request.log.info('egrant ticket areas: unknown instance');
        return send(reply, 404, ErrorCodes.unknownInstance);
      }
      // Emails to active admins, any case; never a new user.
      const admins = new Map((await listAdmins(db)).map((a) => [a.email.toLowerCase(), a]));
      const rules: TicketAreaRuleInput[] = [];
      const unmatched: EgrantTicketAreasResponse['unmatched'] = [];
      for (const row of parsed.data.areas) {
        const admin = admins.get(row.email);
        if (admin) rules.push({ area: row.area, userId: admin.id });
        else unmatched.push({ area: row.area, email: row.email });
      }
      // eGrant signs as a system: the author is the instance (spec §2).
      const by = egrantActor('ticket_areas', group.egrantUrl ?? url);
      const result = await replaceAreaRules(db, group, rules, by, 'egrant');
      const emailOf = new Map([...admins.values()].map((a) => [a.id, a.email]));
      const answer: EgrantTicketAreasResponse = {
        state: result.changed ? 'updated' : 'unchanged',
        group_id: group.id,
        rules: result.rules
          .filter((r) => r.source === 'egrant')
          .map((r) => ({ area: r.area, email: emailOf.get(r.user.id) ?? '' })),
        unmatched,
      };
      if (unmatched.length > 0) {
        // Admin addresses of the eGrant team, logged so the owner can fix the list.
        request.log.warn(
          { groupId: group.id, unmatched },
          'egrant ticket areas: emails of no active admin skipped',
        );
      }
      request.log.info(
        { groupId: group.id, state: answer.state, rows: answer.rules.length },
        'egrant ticket areas: done',
      );
      return reply.code(200).send(answer);
    },
  );
};
