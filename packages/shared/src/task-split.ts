import { z } from 'zod';
import { AI_MAX_TASKS } from './ai.js';
import { ID_RE } from './chat.js';
import { TaskDetailDtoSchema, TaskDraftSchema } from './tasks.js';

// The AI task split (Phase 9): proposals, the AI status and creating the reviewed cards. A module
// of its own, so the web bundles these schemas with the lazy screens that use them.

/** One proposed task card; the review screen edits it before anything is created. */
export const TaskProposalSchema = z.object({
  title: z.string(),
  description: z.string(),
  assigneeIds: z.array(z.string()),
  dueDate: z.string().nullable(),
  urgent: z.boolean(),
  /** Files of the source message that belong to this card (copied when the card is created). */
  messageFileIds: z.array(z.string()),
});
export type TaskProposal = z.infer<typeof TaskProposalSchema>;

export const TaskProposalsSchema = z.object({ tasks: z.array(TaskProposalSchema) });
export type TaskProposals = z.infer<typeof TaskProposalsSchema>;

/** Which AI features the server can run (the UI hides the rest). */
export const AiStatusSchema = z.object({ taskSplit: z.boolean() });
export type AiStatus = z.infer<typeof AiStatusSchema>;

/**
 * A reviewed card made from a chat message: `fileIds` are files uploaded in the review,
 * `messageFileIds` files of the source message (copied onto the card). At most 20 files in all.
 */
export const TaskFromMessageDraftSchema = TaskDraftSchema.extend({
  messageFileIds: z.array(z.string()).max(20).default([]),
}).refine((d) => d.fileIds.length + d.messageFileIds.length <= 20, { path: ['fileIds'] });
export type TaskFromMessageDraft = z.output<typeof TaskFromMessageDraftSchema>;

/** `POST /api/groups/:id/tasks/from-message`: the approved cards, created in this order. */
export const TasksFromMessageSchema = z.object({
  messageId: z.string().regex(ID_RE),
  tasks: z.array(TaskFromMessageDraftSchema).min(1).max(AI_MAX_TASKS),
});
export type TasksFromMessage = z.output<typeof TasksFromMessageSchema>;

export const TasksFromMessageResultSchema = z.object({ tasks: z.array(TaskDetailDtoSchema) });
export type TasksFromMessageResult = z.infer<typeof TasksFromMessageResultSchema>;
