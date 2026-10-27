import { z } from 'zod';
import { FileInfoSchema } from '../files.js';
import { KnowledgeIdsSchema, LinkedKnowledgeSchema } from '../knowledge-links.js';

/**
 * Projects and their events (Phase 33, spec §2, §3, §7.5, §7.6). One file per part, re-exported
 * by `index.ts`; a part refines only its own file (plan, "Conflict rules"). This file is part P1's:
 * the projects, the events, the pickers and the refs that tasks and tickets carry.
 */

export const PROJECT_LIMITS = {
  name: 200,
  description: 10_000,
  files: 20,
  /** The projects card's page. */
  pageSize: 30,
  /** eGrant's project id (`project_id`). */
  egrantId: 100,
} as const;

/** The brand accents a project is drawn in (decision 27), picked by `projectColor`. */
export const ProjectColors = ['purple', 'pink', 'blue', 'coral', 'green'] as const;
export const ProjectColorSchema = z.enum(ProjectColors);
export type ProjectColor = z.infer<typeof ProjectColorSchema>;

/** A stable colour for a project id: 32-bit FNV-1a modulo 5, as the avatars pick theirs. */
export function projectColor(projectId: string): ProjectColor {
  let hash = 0x811c9dc5;
  for (let i = 0; i < projectId.length; i++) {
    hash ^= projectId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ProjectColors[(hash >>> 0) % ProjectColors.length]!;
}

export const ProjectStatusSchema = z.enum(['active', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** `manual`: made by a person; `egrant`: created by the eGrant project endpoint ("From eGrant"). */
export const ProjectSourceSchema = z.enum(['manual', 'egrant']);
export type ProjectSource = z.infer<typeof ProjectSourceSchema>;

const isCalendarDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** A `YYYY-MM-DD` calendar date (an event's day). */
export const EventDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate);

/**
 * The project of a task or a ticket in their DTOs (spec §3.1). `color` is null for a žiadateľ,
 * who sees only the name (decision 7).
 */
export const ProjectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: ProjectColorSchema.nullable(),
});
export type ProjectRefDto = z.infer<typeof ProjectRefSchema>;

/** The event of a task or a ticket in their DTOs; never sent to a žiadateľ. */
export const EventRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  occursOn: z.string(),
});
export type EventRefDto = z.infer<typeof EventRefSchema>;

/**
 * The `{ projectId, eventId }` pair of a task or ticket write (part P2). Optional in the bodies:
 * absent leaves it unchanged; `projectId: null` clears both; an event needs its project.
 */
export const ProjectRefBodySchema = z.object({
  projectId: z.string().min(1).max(100).nullable(),
  eventId: z.string().min(1).max(100).nullable(),
});
export type ProjectRefBody = z.infer<typeof ProjectRefBodySchema>;

export const ProjectPersonSchema = z.object({ id: z.string(), name: z.string() });

/** A project in a select (`GET /api/groups/:id/projects/picker`): every project of the client. */
export const ProjectPickerItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: ProjectColorSchema,
  status: ProjectStatusSchema,
  /** A test project, set only by eGrant (ADR 0073). */
  isTest: z.boolean(),
});
export type ProjectPickerItem = z.infer<typeof ProjectPickerItemSchema>;
export const ProjectPickerSchema = z.array(ProjectPickerItemSchema);

/** An event in a select and in the project sheet (`GET /api/projects/:id/events/picker`). */
export const EventPickerItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  occursOn: z.string(),
  source: ProjectSourceSchema,
});
export type EventPickerItem = z.infer<typeof EventPickerItemSchema>;
export const EventPickerSchema = z.array(EventPickerItemSchema);

/** A row of the projects card (`GET /api/groups/:id/projects`). */
export const ProjectListItemSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  color: ProjectColorSchema,
  status: ProjectStatusSchema,
  source: ProjectSourceSchema,
  /** A test project, set only by eGrant (ADR 0073): the "Test" label. */
  isTest: z.boolean(),
  eventCount: z.number().int(),
  /** The first event from today on (Bratislava date), or null. */
  nextEvent: EventRefSchema.nullable(),
  /** Tasks not in Completed, and tickets New or In progress, on this project. */
  openTasks: z.number().int(),
  openTickets: z.number().int(),
  /** Pending changes from eGrant (part P3; 0 until then). */
  egrantChanges: z.number().int(),
  updatedAt: z.string(),
});
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const ProjectPageSchema = z.object({
  items: z.array(ProjectListItemSchema),
  nextCursor: z.string().nullable(),
});
export type ProjectPage = z.infer<typeof ProjectPageSchema>;

export const ProjectListQuerySchema = z.object({
  status: ProjectStatusSchema.default('active'),
  after: z.string().min(1).max(400).optional(),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

/** One project, for the project sheet and the edit dialog. */
export const ProjectDtoSchema = ProjectListItemSchema.extend({
  description: z.string(),
  files: z.array(FileInfoSchema),
  /** Name keys that also match the project (old names), removable; not the current name's. */
  aliases: z.array(z.string()),
  /** eGrant's id of the project (read-only), when eGrant sent it. */
  egrantProjectId: z.string().nullable(),
  createdBy: ProjectPersonSchema.nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
  /** Knowledge attached to the description (Phase 33 part P5). */
  linkedKnowledge: LinkedKnowledgeSchema,
});
export type ProjectDto = z.infer<typeof ProjectDtoSchema>;

const nameField = z.string().trim().min(1).max(PROJECT_LIMITS.name);
const descriptionField = z.string().max(PROJECT_LIMITS.description);
const fileIdsField = z
  .array(z.string().min(1).max(100))
  .max(PROJECT_LIMITS.files)
  .transform((ids) => [...new Set(ids)]);
const updatedAtField = z.iso.datetime({ offset: true });

/** `POST /api/groups/:id/projects`. */
export const ProjectCreateBodySchema = z.object({
  name: nameField,
  description: descriptionField.default(''),
  fileIds: fileIdsField.default([]),
  knowledgeIds: KnowledgeIdsSchema.optional(),
});
export type ProjectCreateBody = z.output<typeof ProjectCreateBodySchema>;

/** `PATCH /api/projects/:id`: an omitted field stays; a stale `updatedAt` is 409 `project_changed`. */
export const ProjectPatchBodySchema = z.object({
  name: nameField.optional(),
  description: descriptionField.optional(),
  fileIds: fileIdsField.optional(),
  knowledgeIds: KnowledgeIdsSchema.optional(),
  updatedAt: updatedAtField,
});
export type ProjectPatchBody = z.output<typeof ProjectPatchBodySchema>;

/** `POST /api/projects/:id/merge` (part P3): merge this project into `into`. */
export const ProjectMergeBodySchema = z.object({ into: z.string().min(1).max(100) });
export type ProjectMergeBody = z.infer<typeof ProjectMergeBodySchema>;

/** One event, for the event sheet and the edit dialog. */
export const ProjectEventDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  groupId: z.string(),
  project: ProjectRefSchema,
  name: z.string(),
  description: z.string(),
  occursOn: z.string(),
  source: ProjectSourceSchema,
  files: z.array(FileInfoSchema),
  createdBy: ProjectPersonSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Knowledge attached to the description (Phase 33 part P5). */
  linkedKnowledge: LinkedKnowledgeSchema,
});
export type ProjectEventDto = z.infer<typeof ProjectEventDtoSchema>;

/** `POST /api/projects/:id/events`. */
export const EventCreateBodySchema = z.object({
  name: nameField,
  occursOn: EventDateSchema,
  description: descriptionField.default(''),
  fileIds: fileIdsField.default([]),
  knowledgeIds: KnowledgeIdsSchema.optional(),
});
export type EventCreateBody = z.output<typeof EventCreateBodySchema>;

/** `PATCH /api/project-events/:id`. */
export const EventPatchBodySchema = z.object({
  name: nameField.optional(),
  occursOn: EventDateSchema.optional(),
  description: descriptionField.optional(),
  fileIds: fileIdsField.optional(),
  knowledgeIds: KnowledgeIdsSchema.optional(),
  updatedAt: updatedAtField,
});
export type EventPatchBody = z.output<typeof EventPatchBodySchema>;

/** 409 `project_name_taken`: another project of the client has this name (or alias). */
export const ProjectNameTakenSchema = z.object({
  error: z.literal('project_name_taken'),
  name: z.string(),
});

/** Socket events of projects (spec §8), to `group:<id>` after the write commits. */
export const ProjectEvents = { changed: 'project:changed' } as const;
export type ProjectChangeKind = 'project' | 'event' | 'egrant';
export type ProjectChangedEvent = {
  groupId: string;
  projectId: string;
  kind: ProjectChangeKind;
};
