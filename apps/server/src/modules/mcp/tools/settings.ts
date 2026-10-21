import { z } from 'zod';
import {
  GroupModeSchema,
  NotificationCategorySchema,
  NotificationChannelSchema,
  SavedViewBodySchema,
  SavedViewPageSchema,
  SetSubstitutionBodySchema,
  SnippetBodySchema,
  SnippetPatchSchema,
} from '@spolu/shared';
import type { ToolOutcome } from './define.js';
import { defineTool, fromApi, idArg, idOf, type ToolDef } from './define.js';

/** The user's own settings: notifications, canned replies, saved views; and substitutions. */
export const settingsTools: ToolDef[] = [
  defineTool({
    name: 'get_notification_settings',
    title: 'Get notification settings',
    description:
      'How the user is notified (Settings → Notifications): `preferences.channels` per group of events (chat, tasks, tickets, knowledge, meetings, …: "email", "push", "both" or "none") and `modes` (the default mode for clients and each client’s own mode).',
    input: z.object({}),
    run: async ({ api }) => {
      const [preferences, modes] = await Promise.all([
        api('GET', '/api/notifications/preferences'),
        api('GET', '/api/notifications/modes'),
      ]);
      if (preferences.status !== 200) return fromApi(preferences);
      if (modes.status !== 200) return fromApi(modes);
      return { status: 200, data: { preferences: preferences.body, modes: modes.body } };
    },
  }),
  defineTool({
    name: 'update_notification_settings',
    title: 'Update notification settings',
    description:
      'Changes how the user is notified; give one or more: `channel` (`category` and its `channel`), `defaultMode` (the mode for clients without their own) or `groupMode` (`groupId` and `mode`, one client). Modes as get_notification_settings shows them. Answers the settings after the change.',
    input: z
      .object({
        channel: z
          .object({ category: NotificationCategorySchema, channel: NotificationChannelSchema })
          .optional(),
        defaultMode: GroupModeSchema.optional(),
        groupMode: z.object({ groupId: idArg('group'), mode: GroupModeSchema }).optional(),
      })
      .refine((v) => v.channel || v.defaultMode || v.groupMode, {
        message: 'give channel, defaultMode or groupMode',
      }),
    write: true,
    run: async ({ api }, { channel, defaultMode, groupMode }) => {
      const steps: Array<() => ReturnType<typeof api>> = [];
      if (channel)
        steps.push(() => api('PATCH', '/api/notifications/preferences', { body: channel }));
      if (defaultMode) {
        steps.push(() =>
          api('PUT', '/api/notifications/modes/default', { body: { mode: defaultMode } }),
        );
      }
      if (groupMode) {
        steps.push(() =>
          api('PUT', `/api/groups/${groupMode.groupId}/notification-mode`, {
            body: { mode: groupMode.mode },
          }),
        );
      }
      for (const step of steps) {
        const res = await step();
        if (res.status >= 400) return fromApi(res);
      }
      const [preferences, modes] = await Promise.all([
        api('GET', '/api/notifications/preferences'),
        api('GET', '/api/notifications/modes'),
      ]);
      const outcome: ToolOutcome = {
        status: 200,
        data: { preferences: preferences.body, modes: modes.body },
      };
      return outcome;
    },
  }),
  defineTool({
    name: 'list_snippets',
    title: 'List canned replies',
    description:
      'The user’s canned replies ("Šablóny odpovedí") and the ones other managers share: title, body (`{{name}}` becomes the recipient’s first name), `shared`, the author.',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/snippets')),
  }),
  defineTool({
    name: 'create_snippet',
    title: 'Create a canned reply',
    description:
      'Saves a canned reply: `title`, `body` (Markdown; `{{name}}` for the recipient’s first name), `shared` (other managers see and use it; default false).',
    input: z.object({ snippet: SnippetBodySchema }),
    write: true,
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/snippets', { body: raw.snippet });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    name: 'update_snippet',
    title: 'Update a canned reply',
    description:
      'Changes the user’s own canned reply: `title`, `body`, `shared`; only those given.',
    input: z.object({ snippetId: idArg('snippet'), changes: SnippetPatchSchema }),
    write: true,
    target: ({ snippetId }) => snippetId,
    run: async ({ api }, { snippetId }, raw) =>
      fromApi(await api('PATCH', `/api/snippets/${snippetId}`, { body: raw.changes })),
  }),
  defineTool({
    name: 'list_saved_views',
    title: 'List saved views',
    description:
      'The user’s saved filters of a page (`page`: "board" = Tasks, "tickets", "knowledge", "finance" for finance holders): name and the app link it opens.',
    input: z.object({ page: SavedViewPageSchema }),
    run: async ({ api }, { page }) =>
      fromApi(await api('GET', '/api/me/saved-views', { query: { page } })),
  }),
  defineTool({
    name: 'create_saved_view',
    title: 'Save a view',
    description:
      'Saves a filter of a page under a name: `page`, `name`, `url` (the page’s app path with its filters, e.g. "/tickets?status=all&assignee=me").',
    input: z.object({ view: SavedViewBodySchema }),
    write: true,
    run: async ({ api }, _args, raw) => {
      const res = await api('POST', '/api/me/saved-views', { body: raw.view });
      return { ...fromApi(res), targetId: idOf(res.body, null) };
    },
  }),
  defineTool({
    name: 'set_admin_substitution',
    title: 'Start a substitution',
    description:
      'A manager is away: another active manager (`substituteId`, from list_admins) substitutes them (`adminId`) until `endsOn` (a day, or null for until ended), taking over their clients for that time. Every client concerned sees the substitute at once. Ending a substitution stays in the app.',
    input: z.object({
      adminId: idArg('manager'),
      substitution: SetSubstitutionBodySchema,
    }),
    write: true,
    target: ({ adminId }) => adminId,
    run: async ({ api }, { adminId }, raw) =>
      fromApi(await api('PUT', `/api/admins/${adminId}/substitution`, { body: raw.substitution })),
  }),
  defineTool({
    name: 'get_announcement',
    title: "Get what's new",
    description:
      'The "What’s new" (Novinky) popup the user has not closed yet: `announcement` is null, or its `id` (a day) and `sections` — only those the user can use: "taskSplit" (generate tasks from a text on a board), "snippets" (saved replies inserted with / in a message), "bulkEmail" (the container block of bulk email), "finance" (salaries and contracts v2; finance holders only).',
    input: z.object({}),
    run: async ({ api }) => fromApi(await api('GET', '/api/me/announcement')),
  }),
  defineTool({
    name: 'mark_announcement_seen',
    title: "Mark what's new as seen",
    description:
      'Closes the "What’s new" popup for the user (`announcementId` from get_announcement) on every device, as closing it in the app does; it is not shown again.',
    input: z.object({ announcementId: z.string().min(1).max(40) }),
    write: true,
    target: ({ announcementId }) => announcementId,
    run: async ({ api }, { announcementId }) =>
      fromApi(await api('POST', `/api/me/announcement/${encodeURIComponent(announcementId)}/seen`)),
  }),
];
