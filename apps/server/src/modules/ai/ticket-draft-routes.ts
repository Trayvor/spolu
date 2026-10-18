import { performance } from 'node:perf_hooks';
import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, ID_RE, TicketDraftRequestSchema, type TicketDraft } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, createSlidingRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { canDraftTicketReply } from '../tickets/policy.js';
import { getTicketRow } from '../tickets/service.js';
import { AiFailedError, AiTimeoutError } from './provider.js';
import { withTimeout } from './text-tools.js';
import { buildTicketDraftContext } from './ticket-draft-context.js';
import { sanitizeDraft, TICKET_DRAFT_TIMEOUT_MS, type TicketDraftResult } from './ticket-draft.js';

type IdParams = { Params: { id: string } };
type Outcome = 'ok' | 'failed' | 'timeout';

/**
 * Per admin a burst limit and a sliding daily cap; one daily cap for the installation protects
 * the key from a loop (spec §11, about 3 USD a day at most).
 */
const TICKET_DRAFT_LIMITS = { perMinute: 5, perDay: 60, installationPerDay: 500 } as const;
const DAY_MS = 86_400_000;

/**
 * "Navrhnúť odpoveď" (2026-10-19): `POST /api/tickets/:id/ai-draft` drafts a reply to a ticket
 * with AI, for admins only. It writes nothing: no message, no socket event, no notification; the
 * admin inserts the draft into the composer and sends it as any message. Every call that reaches
 * the provider is logged without the texts. See
 * docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md §7.
 */
export const ticketDraftRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const anyUser = requireUser(app.auth);
  const perMinute = createRateLimiter({
    windowMs: 60_000,
    max: deps.config.aiBurstLimits?.ticketDraftPerMinute ?? TICKET_DRAFT_LIMITS.perMinute,
  });
  const perDay = createSlidingRateLimiter({ windowMs: DAY_MS, max: TICKET_DRAFT_LIMITS.perDay });
  const installation = createSlidingRateLimiter({
    windowMs: DAY_MS,
    max: TICKET_DRAFT_LIMITS.installationPerDay,
  });

  app.post<IdParams>('/tickets/:id/ai-draft', { preHandler: anyUser }, async (request, reply) => {
    const actor = request.user!;
    // Before the lookup, so nobody else can probe ticket ids.
    if (!canDraftTicketReply(actor)) return reply.code(403).send({ error: ErrorCodes.forbidden });
    const parsed = TicketDraftRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    const id = request.params.id;
    const ticket = ID_RE.test(id) ? await getTicketRow(deps.db, id) : null;
    if (!ticket) return reply.code(404).send({ error: ErrorCodes.notFound });
    const provider = deps.ticketDraft;
    if (provider === null) return reply.code(503).send({ error: ErrorCodes.aiUnavailable });
    // Every limit counts the call: a refused minute does not use up the day.
    if (!perMinute(actor.id) || !perDay(actor.id) || !installation('all')) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }

    // No transaction and no lock is held during the AI call.
    const context = await buildTicketDraftContext(deps.db, ticket, parsed.data.instructions);
    const started = performance.now();
    const log = (outcome: Outcome, usage: TicketDraftResult['usage']) =>
      request.log.info(
        {
          ai: {
            userId: actor.id,
            ticketId: ticket.id,
            sources: context.sources.size,
            durationMs: Math.round(performance.now() - started),
            outcome,
            usage,
          },
        },
        'ai ticket draft',
      );
    let result: TicketDraftResult;
    try {
      result = await withTimeout(
        (signal) => provider.draft(context.request, signal),
        TICKET_DRAFT_TIMEOUT_MS,
      );
    } catch (error) {
      if (!(error instanceof AiFailedError)) throw error;
      log(error instanceof AiTimeoutError ? 'timeout' : 'failed', null);
      request.log.warn({ reason: error.message }, 'ai ticket draft failed');
      return reply.code(502).send({ error: ErrorCodes.aiFailed });
    }
    log('ok', result.usage);
    const clean = sanitizeDraft(
      result,
      new Set(context.sources.keys()),
      context.otherClientIdentities,
    );
    const body: TicketDraft = {
      reply: clean.reply,
      sources: clean.sourceIds.map((sourceId) => context.sources.get(sourceId)!),
    };
    return body;
  });
};
