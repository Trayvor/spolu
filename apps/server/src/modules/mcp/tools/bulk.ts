import { z } from 'zod';
import {
  BulkAudienceSchema,
  BulkCampaignCreateSchema,
  BulkCampaignDraftSchema,
} from '@spolu/shared';
import { defineTool, fromApi, idArg, idOf, query, type ToolDef } from './define.js';

/**
 * Bulk email beyond the reads in `home.ts`: the audience, drafts and a test to oneself. Sending
 * to the recipients and cancelling stay in the app (never on the allowlist).
 */
export const bulkTools: ToolDef[] = [
  defineTool({
    name: 'count_bulk_audience',
    admin: true,
    title: 'Count a bulk email audience',
    description:
      'How many people an audience reaches: `groupIds` (clients), `managerIds` (the clients these managers manage), `roles` ("client", "ziadatel", "admin"), `includeUserIds`, `excludeUserIds`. Changes nothing.',
    input: z.object({ audience: BulkAudienceSchema }),
    run: async ({ api }, _args, raw) =>
      fromApi(await api('POST', '/api/bulk-email/audience/count', { body: raw.audience })),
  }),
  defineTool({
    name: 'list_bulk_people',
    admin: true,
    title: 'List a bulk email audience',
    description:
      'The people an audience (as count_bulk_audience) reaches, by name, with role and clients; paged with `cursor` from `nextCursor`. Changes nothing.',
    input: z.object({
      audience: BulkAudienceSchema,
      cursor: z.string().min(1).max(500).optional(),
    }),
    run: async ({ api }, { cursor }, raw) =>
      fromApi(
        await api('POST', '/api/bulk-email/audience/people', {
          query: query({ cursor }),
          body: raw.audience,
        }),
      ),
  }),
  defineTool({
    name: 'search_bulk_people',
    admin: true,
    title: 'Find people for a bulk email',
    description:
      'People by a name or email fragment `q`, for `includeUserIds` or `excludeUserIds` of an audience.',
    input: z.object({ q: z.string().max(100) }),
    run: async ({ api }, { q }) =>
      fromApi(await api('GET', '/api/bulk-email/people', { query: { q } })),
  }),
  defineTool({
    name: 'get_bulk_sender',
    admin: true,
    title: 'Get the bulk email sender',
    description: 'The sender address bulk email goes out from.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/bulk-email/sender')),
  }),
  defineTool({
    name: 'create_bulk_campaign',
    admin: true,
    title: 'Create a bulk email draft',
    description:
      'A new, empty bulk email draft named `name`; fill it with update_bulk_campaign. Nothing is sent: sending to the recipients is done in the app.',
    input: BulkCampaignCreateSchema,
    write: true,
    run: async ({ api }, args) => {
      const res = await api('POST', '/api/bulk-email/campaigns', { body: args });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    name: 'update_bulk_campaign',
    admin: true,
    title: 'Save a bulk email draft',
    description:
      'Saves a draft as a whole: `name`, `subject`, `preheader`, `blocks` (as get_bulk_campaign describes them), optional `phoneBlocks` (null follows the computer version; left out keeps it), `audience` (as count_bulk_audience) and `version` (the draft’s, from get_bulk_campaign; 409 if someone saved meanwhile). Only drafts; nothing is sent.',
    input: z.object({ campaignId: idArg('campaign'), draft: BulkCampaignDraftSchema }),
    write: true,
    target: ({ campaignId }) => campaignId,
    run: async ({ api }, { campaignId }, raw) =>
      fromApi(await api('PUT', `/api/bulk-email/campaigns/${campaignId}`, { body: raw.draft })),
  }),
  defineTool({
    name: 'send_bulk_campaign_test',
    admin: true,
    title: 'Send a bulk email test to myself',
    description:
      'Sends the draft once to the user’s own email address only, subject prefixed "[Test]"; answers `to`. Never to the recipients. The draft must be complete (subject, content, audience), else 400 with the problems.',
    input: z.object({ campaignId: idArg('campaign') }),
    write: true,
    target: ({ campaignId }) => campaignId,
    run: async ({ api }, { campaignId }) =>
      fromApi(await api('POST', `/api/bulk-email/campaigns/${campaignId}/test`)),
  }),
];
