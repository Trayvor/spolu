import { z } from 'zod';
import {
  EventCreateBodySchema,
  EventPatchBodySchema,
  ProjectCreateBodySchema,
  ProjectPatchBodySchema,
  TIMELINE_LIMITS,
} from '@spolu/shared';
import {
  cursorArg,
  defineTool,
  fromApi,
  idArg,
  idOf,
  patchVersioned,
  query,
  type ToolDef,
} from './define.js';

/** A client's projects (grant projects) and their events (dated milestones). */
export const projectTools: ToolDef[] = [
  defineTool({
    name: 'list_projects',
    title: 'List projects',
    description:
      'A client’s projects (`status` "active", default, or "archived"), paged with `after` from `nextCursor`.',
    input: z.object({
      groupId: idArg('group'),
      status: z.enum(['active', 'archived']).optional(),
      after: cursorArg,
    }),
    run: async ({ api }, { groupId, ...rest }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/projects`, { query: query(rest) })),
  }),
  defineTool({
    name: 'get_project',
    title: 'Get a project',
    description: 'One project with its description, files, aliases and linked knowledge.',
    input: z.object({ projectId: idArg('project') }),
    run: async ({ api }, { projectId }) => fromApi(await api('GET', `/api/projects/${projectId}`)),
  }),
  defineTool({
    name: 'get_project_event',
    title: 'Get a project event',
    description: 'One event of a project (a dated milestone) with its description and files.',
    input: z.object({ eventId: idArg('event') }),
    run: async ({ api }, { eventId }) =>
      fromApi(await api('GET', `/api/project-events/${eventId}`)),
  }),
  defineTool({
    name: 'create_project',
    title: 'Create a project',
    description: 'Creates a project of a client as the user (a unique name per client).',
    input: z.object({ groupId: idArg('group'), project: ProjectCreateBodySchema }),
    write: true,
    target: ({ groupId }) => groupId,
    run: async ({ api }, { groupId }, raw) => {
      const res = await api('POST', `/api/groups/${groupId}/projects`, { body: raw.project });
      return { ...fromApi(res), targetId: idOf(res.body, groupId) };
    },
  }),
  defineTool({
    name: 'update_project',
    title: 'Update a project',
    description:
      'Changes a project’s name, description or linked knowledge (`changes`); the others stay. Pass `updatedAt` to refuse a stale edit; without it the current version is used.',
    input: z.object({
      projectId: idArg('project'),
      changes: ProjectPatchBodySchema.partial({ updatedAt: true }),
    }),
    write: true,
    target: ({ projectId }) => projectId,
    run: async ({ api }, { projectId }, raw) =>
      patchVersioned(api, `/api/projects/${projectId}`, raw.changes as Record<string, unknown>),
  }),
  defineTool({
    name: 'create_project_event',
    title: 'Create a project event',
    description: 'Adds an event (name, `occursOn` date, description) to a project as the user.',
    input: z.object({ projectId: idArg('project'), event: EventCreateBodySchema }),
    write: true,
    target: ({ projectId }) => projectId,
    run: async ({ api }, { projectId }, raw) => {
      const res = await api('POST', `/api/projects/${projectId}/events`, { body: raw.event });
      return { ...fromApi(res), targetId: idOf(res.body, projectId) };
    },
  }),
  defineTool({
    name: 'update_project_event',
    title: 'Update a project event',
    description:
      'Changes an event’s name, date, description or linked knowledge (`changes`). Pass `updatedAt` to refuse a stale edit; without it the current version is used.',
    input: z.object({
      eventId: idArg('event'),
      changes: EventPatchBodySchema.partial({ updatedAt: true }),
    }),
    write: true,
    target: ({ eventId }) => eventId,
    run: async ({ api }, { eventId }, raw) =>
      patchVersioned(api, `/api/project-events/${eventId}`, raw.changes as Record<string, unknown>),
  }),
  defineTool({
    name: 'get_group_timeline',
    title: 'Get a client’s timeline',
    description:
      'The dated events of a client’s projects in order (the Timeline): a page `around` a day ("today", default, or YYYY-MM-DD), optionally of one `project`; `before`/`after` from the answer page earlier or later.',
    input: z.object({
      groupId: idArg('group'),
      project: idArg('project').optional(),
      around: z.union([z.literal('today'), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
      before: z.string().min(1).max(400).optional(),
      after: z.string().min(1).max(400).optional(),
      limit: z.number().int().min(1).max(TIMELINE_LIMITS.page).optional(),
    }),
    run: async ({ api }, { groupId, ...rest }) =>
      fromApi(await api('GET', `/api/groups/${groupId}/timeline`, { query: query(rest) })),
  }),
];
