import { z } from 'zod';
import { cursorArg, defineTool, fromApi, idArg, query, type ToolDef } from './define.js';

const week = z
  .string()
  .regex(/^\d{4}-W\d{2}$/)
  .describe('An ISO week such as 2026-W43');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The weekly client summaries (every admin reads them; editing and sending stay in the app). */
export const weeklySummaryTools: ToolDef[] = [
  defineTool({
    name: 'list_weekly_summaries',
    title: 'List weekly client summaries',
    description:
      'The weekly summaries e-mailed to each client ("Týždenný prehľad"). Without `archive`: one week’s list (`week`, default this week; `scope` "mine" = the clients the user manages, default, or "all"; `status` "review" (drafts, default), "sent" or "all"), with `olderDrafts`. With `archive: true`: every past summary, filtered by `groupId` (a client; find one with list_weekly_summary_clients), `from`/`to` (days), `q` (text) and `archiveStatus` ("sent", "unsent", "all"). Paged with `cursor` from `nextCursor`.',
    input: z.object({
      archive: z.boolean().optional(),
      week: week.optional(),
      scope: z.enum(['mine', 'all']).optional(),
      status: z.enum(['review', 'sent', 'all']).optional(),
      groupId: idArg('group').optional(),
      from: day.optional(),
      to: day.optional(),
      q: z.string().max(200).optional(),
      archiveStatus: z.enum(['sent', 'unsent', 'all']).optional(),
      cursor: cursorArg,
      limit: z.number().int().min(1).max(50).optional(),
    }),
    run: async ({ api }, { archive, week, scope, status, archiveStatus, ...rest }) =>
      fromApi(
        archive
          ? await api('GET', '/api/weekly-summaries/archive', {
              query: query({ ...rest, status: archiveStatus }),
            })
          : await api('GET', '/api/weekly-summaries', {
              query: query({ week, scope, status, cursor: rest.cursor, limit: rest.limit }),
            }),
      ),
  }),
  defineTool({
    name: 'list_weekly_summary_clients',
    title: 'Find clients for the summary archive',
    description:
      'Clients by a name fragment `q` (up to 20), for the `groupId` filter of list_weekly_summaries.',
    input: z.object({ q: z.string().max(100).optional() }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/weekly-summaries/groups', { query: query(args) })),
  }),
  defineTool({
    name: 'get_weekly_summary',
    title: 'Get a weekly client summary',
    description:
      'One weekly summary: its client, week, status (draft, sent, skipped), the content sections, language, recipients and who saved or sent it.',
    input: z.object({ summaryId: idArg('summary') }),
    run: async ({ api }, { summaryId }) =>
      fromApi(await api('GET', `/api/weekly-summaries/${summaryId}`)),
  }),
  defineTool({
    name: 'get_my_weekly_summary',
    title: 'Get my weekly summary setting',
    description:
      'Whether the user is reminded to review their clients’ weekly summaries (`remind`, the profile setting).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/weekly-summary/reminder')),
  }),
];
