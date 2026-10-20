import { z } from 'zod';
import { ReminderPutSchema } from '@spolu/shared';
import { defineTool, fromApi, idArg, type ToolDef } from './define.js';

/**
 * The route prefix of each reminder subject (`reminders/routes.ts`), finance items excluded.
 * Only tasks and project events set their times on their own; a knowledge reminder's times are
 * edited with the item (update_knowledge_item).
 */
const PREFIX = { task: 'tasks', project_event: 'project-events', knowledge: 'knowledge' } as const;

/** The reminders (times and recipients) of tasks, project events and knowledge items. */
export const reminderTools: ToolDef[] = [
  defineTool({
    name: 'get_reminders',
    title: 'Get reminders',
    description:
      'The reminders of a task, a project event or a knowledge item (`subject`, `id`): the times (each with `firedAt` once sent), the recipients and how they became one, whether the user is a recipient and may edit them. The user’s next reminders everywhere: list_upcoming_reminders.',
    input: z.object({
      subject: z.enum(['task', 'project_event', 'knowledge']),
      id: idArg('subject'),
    }),
    run: async ({ api }, { subject, id }) =>
      fromApi(await api('GET', `/api/${PREFIX[subject]}/${id}/reminders`)),
  }),
  defineTool({
    name: 'set_reminders',
    title: 'Set reminders',
    description:
      'Sets the upcoming reminder times of a task or a project event (`subject`, `id`): `reminders.times` (ISO date-times in the future; keep an existing one by its `id`) and `reminders.recipientIds` (people of the client; left out keeps them). `reminders.baseTimeIds`: the unfired time ids read last (get_reminders); a listed one missing from `times` is removed. Left out, every current unfired time is the base, so `times` replaces them all (`times: []` removes them). Recipients get them by their notification settings. Knowledge reminders: update_knowledge_item.',
    input: z.object({
      subject: z.enum(['task', 'project_event']),
      id: idArg('subject'),
      reminders: ReminderPutSchema,
    }),
    write: true,
    target: ({ id }) => id,
    run: async ({ api }, { subject, id }, raw) => {
      const path = `/api/${PREFIX[subject]}/${id}/reminders`;
      let body = raw.reminders as Record<string, unknown>;
      if (body.baseTimeIds === undefined) {
        const current = await api('GET', path);
        const times = (current.body as { times?: unknown } | null)?.times;
        if (current.status !== 200 || !Array.isArray(times)) return fromApi(current);
        const unfired = (times as Array<{ id: string; firedAt: string | null }>)
          .filter((t) => t.firedAt === null)
          .map((t) => t.id);
        body = { ...body, baseTimeIds: unfired };
      }
      return fromApi(await api('PUT', path, { body }));
    },
  }),
];
