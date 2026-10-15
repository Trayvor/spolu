import { z } from 'zod';
import { FileInfoSchema } from './files.js';

export const BucketKindSchema = z.enum([
  'todo',
  'egrant_review',
  'client_review',
  'done',
  'custom',
]);
export type BucketKind = z.infer<typeof BucketKindSchema>;

export const BucketDtoSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  kind: BucketKindSchema,
  /** Set for custom buckets only; the UI names the fixed ones. */
  name: z.string().nullable(),
  /** Fractional-index key; sort byte-wise. */
  position: z.string(),
});
export type BucketDto = z.infer<typeof BucketDtoSchema>;

export const TaskPersonSchema = z.object({ id: z.string(), name: z.string() });
export type TaskPerson = z.infer<typeof TaskPersonSchema>;

const isCalendarDate = (value: string): boolean => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const titleField = z.string().trim().min(1).max(200);
const descriptionField = z.string().max(10_000);
const assigneeIdsField = z
  .array(z.string())
  .max(10)
  .transform((ids) => [...new Set(ids)]);
const dueDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate)
  .nullable();
const fileIdsField = z.array(z.string()).max(20);

/** The editable content of a task; the create endpoint and the task form share it. */
export const TaskDraftSchema = z.object({
  title: titleField,
  description: descriptionField.default(''),
  assigneeIds: assigneeIdsField.default([]),
  dueDate: dueDateField.default(null),
  urgent: z.boolean().default(false),
  fileIds: fileIdsField.default([]),
});
export type TaskDraft = z.output<typeof TaskDraftSchema>;

export const TaskCreateSchema = TaskDraftSchema.extend({ bucketId: z.string().optional() });
export type TaskCreate = z.output<typeof TaskCreateSchema>;

/** Every field optional without defaults: an omitted field stays unchanged. */
export const TaskPatchSchema = z.object({
  title: titleField.optional(),
  description: descriptionField.optional(),
  assigneeIds: assigneeIdsField.optional(),
  dueDate: dueDateField.optional(),
  urgent: z.boolean().optional(),
  fileIds: fileIdsField.optional(),
  /** `updatedAt` of the version being edited; a stale value answers 409 `task_changed`. */
  updatedAt: z.iso.datetime({ offset: true }),
});
export type TaskPatch = z.output<typeof TaskPatchSchema>;

export const TaskMoveSchema = z.object({
  bucketId: z.string(),
  afterTaskId: z.string().nullable(),
});
export type TaskMove = z.infer<typeof TaskMoveSchema>;

const bucketName = z.string().trim().min(1).max(60);
export const BucketCreateSchema = z.object({ name: bucketName });
export type BucketCreate = z.infer<typeof BucketCreateSchema>;

export const BucketPatchSchema = z
  .object({ name: bucketName.optional(), afterBucketId: z.string().optional() })
  .refine((v) => v.name !== undefined || v.afterBucketId !== undefined);
export type BucketPatch = z.infer<typeof BucketPatchSchema>;

export const TaskDtoSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  bucketId: z.string(),
  position: z.string(),
  title: z.string(),
  urgent: z.boolean(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdBy: TaskPersonSchema,
  assignees: z.array(TaskPersonSchema),
  fileCount: z.number().int(),
  sourceMessageId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskDto = z.infer<typeof TaskDtoSchema>;

export const SourceMessageSchema = z.object({
  id: z.string(),
  authorName: z.string(),
  excerpt: z.string(),
});
export type SourceMessage = z.infer<typeof SourceMessageSchema>;

export const TaskDetailDtoSchema = TaskDtoSchema.extend({
  description: z.string(),
  files: z.array(FileInfoSchema),
  sourceMessage: SourceMessageSchema.nullable(),
});
export type TaskDetailDto = z.infer<typeof TaskDetailDtoSchema>;

export const BoardDtoSchema = z.object({
  buckets: z.array(BucketDtoSchema),
  tasks: z.array(TaskDtoSchema),
});
export type BoardDto = z.infer<typeof BoardDtoSchema>;

/** Socket events pushed to the group room after a board write commits. */
export const BoardEvents = {
  task: 'board:task',
  taskDeleted: 'board:task_deleted',
  buckets: 'board:buckets',
} as const;

export type BoardTaskEvent = { task: TaskDto; actor: TaskPerson };
export type BoardTaskDeletedEvent = { groupId: string; taskId: string };
export type BoardBucketsEvent = { groupId: string; buckets: BucketDto[] };

/** A bucket as shown in a notification: custom name, the group name for `client_review`, else null. */
export type BucketLabel = { kind: BucketKind; name: string | null };

export type TaskMovedPayload = {
  taskId: string;
  groupId: string;
  title: string;
  fromBucket: BucketLabel;
  toBucket: BucketLabel;
  actorName: string;
};
export type TaskAssignedPayload = {
  taskId: string;
  groupId: string;
  title: string;
  actorName: string;
};
