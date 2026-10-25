import { z } from 'zod';
import {
  BOARD_DONE_MAX,
  BucketCreateSchema,
  BucketPatchSchema,
  TaskCreateSchema,
  TaskMoveSchema,
  TaskPatchSchema,
  TasksFromMessageSchema,
  TasksFromTicketSchema,
} from '@spolu/shared';
import {
  cursorArg,
  defineTool,
  fromApi,
  idArg,
  idOf,
  omit,
  patchVersioned,
  query,
  type ToolDef,
} from './define.js';

/** `askTime` (ask the admin for their time) is about finance: never in an MCP answer. */
const noTime = omit(['askTime']);

/** Task boards: buckets, tasks, search, the global board; create, edit and move tasks. */
export const taskTools: ToolDef[] = [
  defineTool({
    name: 'get_board',
    title: 'Get a task board',
    description:
      'A group’s task board: its buckets (columns; "todo", "in progress", "done" = Completed, and custom ones) and tasks: all open ones and the first completed ones (`done`: how many completed to bring, default 15). More completed: list_completed_tasks.',
    input: z.object({
      groupId: idArg('group'),
      done: z.number().int().min(1).max(BOARD_DONE_MAX).optional(),
    }),
    run: async ({ api }, { groupId, done }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/board`, { query: query({ done }) })),
  }),
  defineTool({
    name: 'list_completed_tasks',
    title: 'List completed tasks',
    description:
      'The next page of a board’s Completed column; `after` is the board’s `done.next` (or the previous page’s `next`).',
    input: z.object({ groupId: idArg('group'), after: z.string().min(1).max(200) }),
    run: async ({ api }, { groupId, after }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/board/done`, { query: { after } })),
  }),
  defineTool({
    name: 'search_tasks',
    title: 'Search tasks',
    description:
      'A group’s tasks by a title fragment (from 2 characters; empty lists the newest), 20 a page.',
    input: z.object({
      groupId: idArg('group'),
      q: z.string().max(100).optional(),
      after: cursorArg,
    }),
    run: async ({ api }, { groupId, ...rest }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/tasks/search`, { query: query(rest) })),
  }),
  defineTool({
    name: 'get_task',
    title: 'Get a task',
    description:
      'One task with its description, assignees, due date, files, linked knowledge, project and event, and the message, ticket or meeting it was made from.',
    input: z.object({ taskId: idArg('task') }),
    run: async ({ api }, { taskId }) => fromApi(await api('GET', `/api/tasks/${taskId}`)),
  }),
  defineTool({
    name: 'list_all_tasks',
    admin: true,
    title: 'List tasks across clients',
    description:
      'The global task board across clients (admins). Filters: `clients` (comma-separated group ids, or "all"; default the clients the user manages), `assignee` ("me", "anyone", "none" or a person id), `due` ("overdue", "week" or "none"), `q` (title), `urgent`, `mine`, `completed`; paging with `column` and `after` from the answer.',
    input: z.object({
      clients: z.string().max(20_000).optional(),
      assignee: z.string().max(64).optional(),
      due: z.string().max(20).optional(),
      q: z.string().max(100).optional(),
      urgent: z.boolean().optional(),
      mine: z.boolean().optional(),
      completed: z.boolean().optional(),
      column: z.string().max(100).optional(),
      after: z.string().max(1000).optional(),
    }),
    run: async ({ api }, args) =>
      fromApi(await api('GET', '/api/tasks/global', { query: query(args) })),
  }),
  defineTool({
    name: 'list_my_tasks',
    admin: true,
    title: 'List my tasks',
    description: 'The tasks assigned to the user (the dashboard’s My tasks card).',
    input: z.object({}),
    // The "Fill in your time" requests ride on this answer: time is finance, so they are dropped.
    run: async ({ api }) =>
      fromApi(await api('GET', '/api/me/home/tasks'), omit(['timeRequests', 'timeRequestCount'])),
  }),
  defineTool({
    name: 'list_unseen_tasks',
    title: 'List unseen task changes',
    description: 'The user’s tasks of a group with a change they have not seen yet.',
    input: z.object({ groupId: idArg('group') }),
    run: async ({ api }, { groupId }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/board/unseen`)),
  }),
  defineTool({
    name: 'create_task',
    title: 'Create a task',
    description:
      'Creates a task on a group’s board as the user (in To do unless `task.bucketId` names another bucket). Assignees must be the group’s clients or managers (list_group_people); an admin user also assigns any active admin (list_admins). The board updates live and the assignees are notified, as in the app.',
    input: z.object({ groupId: idArg('group'), task: TaskCreateSchema }),
    write: true,
    target: ({ groupId }) => groupId,
    run: async ({ api }, { groupId }, raw) => {
      const res = await api('POST', `/api/groups/${groupId}/tasks`, { body: raw.task });
      return { ...fromApi(res, noTime), targetId: idOf(res.body, groupId) };
    },
  }),
  defineTool({
    name: 'update_task',
    title: 'Update a task',
    description:
      'Changes the fields of a task named in `changes` (title, description, assigneeIds, dueDate "YYYY-MM-DD" or null, urgent, link, projectId, eventId, knowledgeIds); the others stay. Pass the `updatedAt` you read to refuse a stale edit (409 task_changed); without it the current version is used. To move or complete a task: move_task.',
    input: z.object({
      taskId: idArg('task'),
      changes: TaskPatchSchema.partial({ updatedAt: true }),
    }),
    write: true,
    target: ({ taskId }) => taskId,
    run: async ({ api }, { taskId }, raw) =>
      patchVersioned(api, `/api/tasks/${taskId}`, raw.changes as Record<string, unknown>, noTime),
  }),
  defineTool({
    name: 'move_task',
    title: 'Move a task',
    description:
      'Moves a task to a bucket of its board (get_board lists them), after `afterTaskId` (null: first). Moving it into the Completed bucket (kind "done") completes it; out of it reopens it.',
    input: z.object({ taskId: idArg('task'), ...TaskMoveSchema.shape }),
    write: true,
    target: ({ taskId }) => taskId,
    run: async ({ api }, { taskId, bucketId, afterTaskId }) =>
      fromApi(
        await api('POST', `/api/tasks/${taskId}/move`, { body: { bucketId, afterTaskId } }),
        noTime,
      ),
  }),
  defineTool({
    name: 'create_task_from_ticket',
    title: 'Create tasks from a ticket',
    description:
      'Creates reviewed task cards from a ticket of the client (`groupId`, the ticket’s client): `cards.ticketId` and `cards.tasks` (as create_task’s `task`, plus `messageFileIds`: files uploaded with the ticket to copy onto the card). Each card links back to the ticket and takes its project and event unless it names its own. Proposals: suggest_ticket_task_split. The assignees are notified as in the app.',
    input: z.object({ groupId: idArg('group'), cards: TasksFromTicketSchema }),
    write: true,
    target: ({ cards }) => cards.ticketId,
    run: async ({ api }, { groupId }, raw) =>
      fromApi(await api('POST', `/api/groups/${groupId}/tasks/from-ticket`, { body: raw.cards })),
  }),
  defineTool({
    name: 'create_task_from_message',
    title: 'Create tasks from a chat message',
    description:
      'Creates reviewed task cards from a chat message of the client’s chat (`groupId`): `cards.messageId` and `cards.tasks` (as create_task’s `task`, plus `messageFileIds`: the message’s files to copy). Each card links back to the message (and to the ticket of a ticket chat). Proposals: suggest_message_task_split.',
    input: z.object({ groupId: idArg('group'), cards: TasksFromMessageSchema }),
    write: true,
    target: ({ cards }) => cards.messageId,
    run: async ({ api }, { groupId }, raw) =>
      fromApi(await api('POST', `/api/groups/${groupId}/tasks/from-message`, { body: raw.cards })),
  }),
  defineTool({
    name: 'create_bucket',
    admin: true,
    title: 'Create a board column',
    description: 'Managers: adds a custom bucket (column) named `name` to a client’s task board.',
    input: z.object({ groupId: idArg('group'), ...BucketCreateSchema.shape }),
    write: true,
    run: async ({ api }, { groupId, name }) => {
      const res = await api('POST', `/api/groups/${groupId}/buckets`, { body: { name } });
      return { ...fromApi(res), targetId: idOf(res.body, groupId) };
    },
  }),
  defineTool({
    name: 'update_bucket',
    admin: true,
    title: 'Rename or move a board column',
    description:
      'Managers: renames a custom bucket (`name`) or moves it after `afterBucketId` (null: first). The fixed To do, In progress and Completed buckets cannot be changed (400 fixed_bucket).',
    input: z.object({ bucketId: idArg('bucket'), changes: BucketPatchSchema }),
    write: true,
    target: ({ bucketId }) => bucketId,
    run: async ({ api }, { bucketId }, raw) =>
      fromApi(await api('PATCH', `/api/buckets/${bucketId}`, { body: raw.changes })),
  }),
];
