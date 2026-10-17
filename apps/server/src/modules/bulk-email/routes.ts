import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import {
  BULK_PEOPLE_SEARCH,
  BulkAudienceSchema,
  BulkCampaignCreateSchema,
  BulkCampaignDraftSchema,
  BulkPeopleLookupSchema,
  BulkRecipientsQuerySchema,
  ErrorCodes,
  type BulkNotReadyAnswer,
  type BulkSenderDto,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireAdmin } from '../auth/session.js';
import { countAudience, listAudience, lookupPeople, searchPeople } from './audience.js';
import {
  CampaignChangedError,
  CampaignNotFoundError,
  EmptyAudienceError,
  InvalidCursorError,
  NotDraftError,
  NotReadyError,
  NotSendingError,
} from './errors.js';
import { emitBulkUpdated } from './events.js';
import { canUseBulkEmail } from './policy.js';
import {
  createCampaign,
  deleteDraft,
  duplicateCampaign,
  getCampaign,
  listCampaigns,
  listRecipients,
  markPhoneCheckShown,
  saveDraft,
} from './service.js';
import { cancelSending, queueTestSend, startSending } from './send.js';

type IdParams = { Params: { id: string } };

/**
 * The save route's body limit (spec §9): two versions (Phase 31) of 50 blocks, with the text
 * trees' overhead, fit.
 */
const SAVE_BODY_LIMIT = 600_000;

const CursorQuerySchema = z.object({ cursor: z.string().min(1).max(500).optional() });
const SearchQuerySchema = z.object({
  q: z.string().trim().min(BULK_PEOPLE_SEARCH.minQuery).max(BULK_PEOPLE_SEARCH.maxQuery),
});

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });
const invalid = (reply: FastifyReply) => send(reply, 400, ErrorCodes.validationFailed);

/** Maps the expected service errors; anything else is rethrown (500). */
function bulkError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof CampaignNotFoundError) return send(reply, 404, ErrorCodes.notFound);
  if (error instanceof NotDraftError) return send(reply, 409, ErrorCodes.notDraft);
  if (error instanceof CampaignChangedError) return send(reply, 409, ErrorCodes.changed);
  if (error instanceof InvalidCursorError) return invalid(reply);
  if (error instanceof NotSendingError) return send(reply, 409, ErrorCodes.notSending);
  if (error instanceof EmptyAudienceError) return send(reply, 400, ErrorCodes.emptyAudience);
  if (error instanceof NotReadyError) {
    const answer: BulkNotReadyAnswer = { error: ErrorCodes.notReady, problems: error.problems };
    return reply.code(400).send(answer);
  }
  throw error;
}

/** Test sends a minute per admin (spec §4). */
const TEST_SENDS_PER_MINUTE = 10;

/**
 * Campaigns, their audience, sending and the report (spec §2, §4, §6), admins only. Every
 * write pushes `bulk:updated` to the admins room after it succeeded.
 */
export const bulkEmailRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const allowTest = createRateLimiter({ windowMs: 60_000, max: TEST_SENDS_PER_MINUTE });
  const adminOnly = requireAdmin(app.auth);
  const mayUse: preHandlerAsyncHookHandler = async (request, reply) => {
    if (!canUseBulkEmail(request.user!)) return send(reply, 403, ErrorCodes.forbidden);
  };
  const preHandler = [adminOnly, mayUse];

  app.get('/bulk-email/campaigns', { preHandler }, async (request, reply) => {
    const query = CursorQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    try {
      return await listCampaigns(db, query.data.cursor);
    } catch (error) {
      return bulkError(reply, error);
    }
  });

  app.post('/bulk-email/campaigns', { preHandler }, async (request, reply) => {
    const body = BulkCampaignCreateSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const campaign = await createCampaign(db, request.user!, body.data.name);
    emitBulkUpdated(app.io, campaign.id);
    return reply.code(201).send(campaign);
  });

  app.get<IdParams>('/bulk-email/campaigns/:id', { preHandler }, async (request, reply) => {
    const campaign = await getCampaign(db, request.params.id);
    if (!campaign) return send(reply, 404, ErrorCodes.notFound);
    return campaign;
  });

  app.put<IdParams>(
    '/bulk-email/campaigns/:id',
    { preHandler, bodyLimit: SAVE_BODY_LIMIT },
    async (request, reply) => {
      const body = BulkCampaignDraftSchema.safeParse(request.body);
      if (!body.success) return invalid(reply);
      let campaign;
      try {
        campaign = await saveDraft(db, request.user!, request.params.id, body.data);
      } catch (error) {
        return bulkError(reply, error);
      }
      emitBulkUpdated(app.io, campaign.id);
      return campaign;
    },
  );

  app.delete<IdParams>('/bulk-email/campaigns/:id', { preHandler }, async (request, reply) => {
    try {
      await deleteDraft(db, request.params.id);
    } catch (error) {
      return bulkError(reply, error);
    }
    emitBulkUpdated(app.io, request.params.id);
    return reply.code(204).send();
  });

  app.post<IdParams>(
    '/bulk-email/campaigns/:id/duplicate',
    { preHandler },
    async (request, reply) => {
      let campaign;
      try {
        campaign = await duplicateCampaign(db, request.user!, request.params.id);
      } catch (error) {
        return bulkError(reply, error);
      }
      emitBulkUpdated(app.io, campaign.id);
      return reply.code(201).send(campaign);
    },
  );

  app.post('/bulk-email/audience/count', { preHandler }, async (request, reply) => {
    const body = BulkAudienceSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return countAudience(db, body.data);
  });

  app.post('/bulk-email/audience/people', { preHandler }, async (request, reply) => {
    const query = CursorQuerySchema.safeParse(request.query);
    const body = BulkAudienceSchema.safeParse(request.body);
    if (!query.success || !body.success) return invalid(reply);
    try {
      return await listAudience(db, body.data, query.data.cursor);
    } catch (error) {
      return bulkError(reply, error);
    }
  });

  app.get('/bulk-email/people', { preHandler }, async (request, reply) => {
    const query = SearchQuerySchema.safeParse(request.query);
    if (!query.success) return invalid(reply);
    return searchPeople(db, query.data.q);
  });

  app.post('/bulk-email/people/lookup', { preHandler }, async (request, reply) => {
    const body = BulkPeopleLookupSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return lookupPeople(db, body.data.ids);
  });

  // The send dialog names the sender before anything is sent.
  app.get('/bulk-email/sender', { preHandler }, async () => {
    const answer: BulkSenderDto = { sender: deps.config.bulkEmail.from };
    return answer;
  });

  app.post<IdParams>('/bulk-email/campaigns/:id/send', { preHandler }, async (request, reply) => {
    let campaign;
    try {
      campaign = await startSending(deps, request.user!, request.params.id);
    } catch (error) {
      return bulkError(reply, error);
    }
    emitBulkUpdated(app.io, campaign.id);
    return campaign;
  });

  app.post<IdParams>('/bulk-email/campaigns/:id/cancel', { preHandler }, async (request, reply) => {
    let campaign;
    try {
      campaign = await cancelSending(deps, request.params.id);
    } catch (error) {
      return bulkError(reply, error);
    }
    emitBulkUpdated(app.io, campaign.id);
    return campaign;
  });

  app.post<IdParams>('/bulk-email/campaigns/:id/test', { preHandler }, async (request, reply) => {
    if (!allowTest(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    try {
      return reply.code(202).send(await queueTestSend(deps, request.user!, request.params.id));
    } catch (error) {
      return bulkError(reply, error);
    }
  });

  // Phase 31: the one-time "check the phone version" warning was shown (spec §5).
  app.post<IdParams>(
    '/bulk-email/campaigns/:id/phone-check',
    { preHandler },
    async (request, reply) => {
      try {
        await markPhoneCheckShown(db, request.params.id);
      } catch (error) {
        return bulkError(reply, error);
      }
      emitBulkUpdated(app.io, request.params.id);
      return reply.code(204).send();
    },
  );

  app.get<IdParams>(
    '/bulk-email/campaigns/:id/recipients',
    { preHandler },
    async (request, reply) => {
      const query = BulkRecipientsQuerySchema.safeParse(request.query);
      if (!query.success) return invalid(reply);
      try {
        return await listRecipients(db, request.params.id, query.data);
      } catch (error) {
        return bulkError(reply, error);
      }
    },
  );
};
