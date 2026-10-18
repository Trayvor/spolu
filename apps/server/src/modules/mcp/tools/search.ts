import { z } from 'zod';
import { SEARCH_LIMITS } from '@spolu/shared';
import { defineTool, fromApi, query, type ToolDef } from './define.js';

/** The global search (2026-10-18), through the same route as the app's Cmd/Ctrl+K palette. */
export const searchTools: ToolDef[] = [
  defineTool({
    name: 'search',
    title: 'Search everything',
    description:
      'Finds clients (groups), tickets (by #number or subject), tasks, knowledge items, projects and events, and (admins) people by name or email, among what the user may read; nothing of a deactivated client. Diacritics and case do not matter. Answers one list per type, best match first; open the hits with the get_* tools.',
    input: z.object({
      q: z.string().min(SEARCH_LIMITS.minQuery).max(SEARCH_LIMITS.maxQuery),
      types: z
        .string()
        .max(200)
        .optional()
        .describe(
          'A comma list of groups, tickets, tasks, knowledge, projects, people; default all',
        ),
      limit: z.number().int().min(1).max(SEARCH_LIMITS.maxPerType).optional(),
    }),
    run: async ({ api }, args) => fromApi(await api('GET', '/api/search', { query: query(args) })),
  }),
];
