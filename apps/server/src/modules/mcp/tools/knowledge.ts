import { z } from 'zod';
import { KnowledgeDraftSchema, KnowledgePatchSchema } from '@spolu/shared';
import { defineTool, fromApi, idArg, idOf, patchVersioned, query, type ToolDef } from './define.js';

const filters = {
  type: z
    .string()
    .max(100)
    .optional()
    .describe('One type or a comma list: note, file, link, reminder, meeting, chat_file'),
  q: z.string().max(200).optional().describe('Search text (titles, text, file names)'),
  chats: z.enum(['all']).optional().describe('"all" adds the files of task and ticket chats'),
  cursor: z.string().max(200).optional().describe('`nextCursor` of the previous page'),
};

/** The knowledge base: notes, links, files, reminders and meetings, in folders. */
export const knowledgeTools: ToolDef[] = [
  defineTool({
    name: 'list_knowledge',
    title: 'List knowledge',
    description:
      'Knowledge items of one group (`groupId`, optionally in a `folder`: a folder id or "root"), or across groups without it (admins; `clients`: comma-separated group ids, or `scope` "all"; default the groups the user manages). Meetings are items of type "meeting".',
    input: z.object({
      groupId: idArg('group').optional(),
      folder: z.string().max(64).optional(),
      clients: z.string().max(20_000).optional(),
      scope: z.enum(['all']).optional(),
      ...filters,
    }),
    run: async ({ api }, { groupId, folder, clients, scope, ...rest }) =>
      fromApi(
        groupId
          ? await api('GET', `/api/groups/${groupId}/knowledge`, {
              query: query({ ...rest, folder }),
            })
          : await api('GET', '/api/knowledge', { query: query({ ...rest, clients, scope }) }),
      ),
  }),
  defineTool({
    name: 'list_knowledge_folders',
    title: 'List knowledge folders',
    description: 'Every knowledge folder of a group the user may see (a tree by parentId).',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/knowledge/folders`)),
  }),
  defineTool({
    name: 'get_knowledge_item',
    title: 'Get a knowledge item',
    description:
      'One knowledge item with its text, files, folder path, reminders and, for a meeting, its date, participants, transcript summary and tasks.',
    input: z.object({ itemId: idArg('knowledge item') }),
    run: async ({ api }, { itemId }) => fromApi(await api('GET', `/api/knowledge/${itemId}`)),
  }),
  defineTool({
    name: 'list_meetings',
    title: 'List meetings',
    description: 'The meetings on the user’s dashboard (recent and upcoming).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/home/meetings')),
  }),
  defineTool({
    name: 'create_knowledge_item',
    title: 'Create a knowledge item',
    description:
      'Creates a knowledge item in a group as the user: `item.type` "note" (title, body in Markdown), "link" (url), "reminder" (reminder times) or "meeting"; `visibility` "public" (the group’s clients see it) or "admins" (admins only; the admin group’s default), optional `folderId`.',
    input: z.object({ groupId: idArg('group'), item: KnowledgeDraftSchema }),
    write: true,
    target: ({ groupId }) => groupId,
    run: async ({ api }, { groupId }, raw) => {
      const res = await api('POST', `/api/groups/${groupId}/knowledge`, { body: raw.item });
      return { ...fromApi(res), targetId: idOf(res.body, groupId) };
    },
  }),
  defineTool({
    name: 'update_knowledge_item',
    title: 'Update a knowledge item',
    description:
      'Changes the fields of a knowledge item named in `changes` (title, body, url, visibility, folderId, reminder, meeting, knowledgeIds); the others stay. Pass the `updatedAt` you read to refuse a stale edit; without it the current version is used.',
    input: z.object({
      itemId: idArg('knowledge item'),
      changes: KnowledgePatchSchema.partial({ updatedAt: true }),
    }),
    write: true,
    target: ({ itemId }) => itemId,
    run: async ({ api }, { itemId }, raw) =>
      patchVersioned(api, `/api/knowledge/${itemId}`, raw.changes as Record<string, unknown>),
  }),
];
