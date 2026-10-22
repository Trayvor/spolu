import { z } from 'zod';
import { cursorArg, defineTool, fromApi, idArg, query, type ToolDef } from './define.js';

/** The dashboard's counts, mentions, notifications and reminders, and bulk email (read only). */
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
    description:
      'The user’s unread mentions, newest first: chat messages (`source: chat`) and task, ticket, project or knowledge descriptions that name them (`source: description`, with `subjectKind` and `subjectId`).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/mentions')),
  }),
  defineTool({
    name: 'list_notifications',
    title: 'List notifications',
    description:
      'The notification centre (the bell, "Upozornenia"): what the user was notified about in the last 30 days, newest first, with the text, the app link and whether it is unread. Paged with `cursor`.',
    input: z.object({ cursor: cursorArg }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/me/notifications', { query: query(args) })),
  }),
  defineTool({
    name: 'list_upcoming_reminders',
    title: 'List upcoming reminders',
    description: 'The reminders the user will get next (tasks, knowledge items, contracts).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/reminders')),
  }),
  defineTool({
    name: 'get_my_workload',
    title: 'Get the team workload',
    description:
      'The "Team workload" card: every active manager’s open and overdue tasks, open tickets and unseen changes, by client, the busiest first (the user’s own row has `self`). The week’s filled minutes only for a finance holder.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/workload')),
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
    description:
      'One campaign: subject, content, audience, status, counts and `tracking` (people delivered, opened, clicked, bounced and complaints, from Elastic’s webhook when it is set up; opens are approximate); read only. The content is `blocks` (and `phoneBlocks`, null while the phone follows the computer): heading, text, image, button, divider, spacer, logo, and the container `columns`, whose `mode` is `plain` (one area of blocks in `left`) or `split` (two columns `left` and `right`; a container without `mode` is split), with an optional look: `radius` (0–32 px), `background` (a palette key such as `base`, `purpleTint`, or `#RRGGBB`) and `padding` (`none`, `small`, `medium`, `large`).',
    input: z.object({ campaignId: idArg('campaign') }),
    run: async ({ api }, { campaignId }) =>
      fromApi(await api('GET', `/api/bulk-email/campaigns/${campaignId}`)),
  }),
  defineTool({
    name: 'list_bulk_campaign_recipients',
    title: 'List a campaign’s recipients',
    description:
      'The recipients of a sent campaign with their delivery status (`status` filters) and `opened`, `clicked`, `bounced` flags from Elastic’s webhook, paged with `cursor`.',
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
