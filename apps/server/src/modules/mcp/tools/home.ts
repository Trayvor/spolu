import { z } from 'zod';
import { defineTool, fromApi, idArg, query, type ToolDef } from './define.js';

/** The dashboard's counts, mentions and reminders, and bulk email (read only). */
export const homeTools: ToolDef[] = [
  defineTool({
    name: 'get_home_counts',
    title: 'Get unseen counts',
    description:
      'The header badges: how many tasks and tickets have a change the user has not seen yet.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/counts')),
  }),
  defineTool({
    name: 'list_mentions',
    title: 'List mentions',
    description: 'Recent chat messages that mention the user.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/mentions')),
  }),
  defineTool({
    name: 'list_upcoming_reminders',
    title: 'List upcoming reminders',
    description: 'The reminders the user will get next (tasks, knowledge items, contracts).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/reminders')),
  }),
  defineTool({
    name: 'list_bulk_campaigns',
    title: 'List bulk email campaigns',
    description: 'Bulk email campaigns (drafts, sending, sent), newest first; read only.',
    input: z.object({ cursor: z.string().min(1).max(500).optional() }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/bulk-email/campaigns', { query: query(args) })),
  }),
  defineTool({
    name: 'get_bulk_campaign',
    title: 'Get a bulk email campaign',
    description: 'One campaign: subject, content, audience, status and counts; read only.',
    input: z.object({ campaignId: idArg('campaign') }),
    run: async ({ api }, { campaignId }) =>
      fromApi(await api('GET', `/api/bulk-email/campaigns/${campaignId}`)),
  }),
  defineTool({
    name: 'list_bulk_campaign_recipients',
    title: 'List a campaign’s recipients',
    description:
      'The recipients of a sent campaign with their delivery status (`status` filters), paged with `cursor`.',
    input: z.object({
      campaignId: idArg('campaign'),
      status: z.string().max(40).optional(),
      cursor: z.string().min(1).max(500).optional(),
    }),
    run: async ({ api }, { campaignId, ...rest }) =>
      fromApi(
        await api('GET', `/api/bulk-email/campaigns/${campaignId}/recipients`, {
          query: query(rest),
        }),
      ),
  }),
];
