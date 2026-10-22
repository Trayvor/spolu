import { z } from 'zod';
import { AI_MAX_TASKS } from './ai.js';
import { ID_RE, MESSAGE_MAX_LENGTH } from './chat.js';
import { FileInfoSchema } from './files.js';
import { MEETING_LIMITS } from './meetings.js';
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
  /**
   * Files of the source (the message, or the files uploaded with a ticket) that belong to this
   * card (copied when the card is created).
   */
  messageFileIds: z.array(z.string()),
  /**
   * The card's link: a web address of the source text the AI chose, or else a ticket's own URL
   * (owner bug report 2026-10-18); null for none.
   */
  link: z.string().nullable().default(null),
  /**
   * The card's project: an active project of the client the AI chose because the text clearly
   * refers to it, or a ticket's own project (it wins); null for none (owner request 2026-10-22).
   */
  projectId: z.string().nullable().default(null),
});
export type TaskProposal = z.infer<typeof TaskProposalSchema>;

export const TaskProposalsSchema = z.object({
  tasks: z.array(TaskProposalSchema),
  /**
   * The source's files the cards may copy, when the screen does not have them all: a ticket's
   * uploads and the files sent in its chat. Empty for a message and a meeting.
   */
  files: z.array(FileInfoSchema).default([]),
});
export type TaskProposals = z.infer<typeof TaskProposalsSchema>;

/** Which AI features the server can run (the UI hides the rest). */
export const AiStatusSchema = z.object({
  taskSplit: z.boolean(),
  /** A meeting's summary can be made (Phase 30). */
  meetingSummary: z.boolean().default(false),
  /** A meeting's recording can be transcribed (Phase 30). */
  transcription: z.boolean().default(false),
  /** "Navrhnúť odpoveď": an admin can draft a ticket reply with AI (2026-10-19). */
  ticketDraft: z.boolean().default(false),
});
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

/**
 * `POST /api/groups/:id/tasks/from-ticket` (part 21.5): the approved cards of a ticket. Here
 * `messageFileIds` name files uploaded with the ticket (copied onto the card).
 */
export const TasksFromTicketSchema = z.object({
  ticketId: z.string().regex(ID_RE),
  tasks: z.array(TaskFromMessageDraftSchema).min(1).max(AI_MAX_TASKS),
});
export type TasksFromTicket = z.output<typeof TasksFromTicketSchema>;

/**
 * `POST /api/knowledge/:id/meeting/tasks` (Phase 30): the approved cards of a meeting's action
 * items, at the top of `bucketId` (absent: To do). A meeting has no files to copy.
 */
export const TasksFromMeetingSchema = z.object({
  bucketId: z.string().regex(ID_RE).optional(),
  tasks: z.array(TaskFromMessageDraftSchema).min(1).max(MEETING_LIMITS.listItems),
});
export type TasksFromMeeting = z.output<typeof TasksFromMeetingSchema>;

/** `POST /api/groups/:id/task-split-text`: free text (pasted on a board) the AI splits into cards. */
export const TaskSplitTextSchema = z.object({
  text: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
export type TaskSplitText = z.output<typeof TaskSplitTextSchema>;

/**
 * `POST /api/groups/:id/tasks/from-text`: the approved cards of a pasted text, at the top of
 * `bucketId` (absent: To do). A text has no files to copy.
 */
export const TasksFromTextSchema = z.object({
  bucketId: z.string().regex(ID_RE).optional(),
  tasks: z.array(TaskFromMessageDraftSchema).min(1).max(AI_MAX_TASKS),
});
export type TasksFromText = z.output<typeof TasksFromTextSchema>;

export const TasksFromMessageResultSchema = z.object({ tasks: z.array(TaskDetailDtoSchema) });
export type TasksFromMessageResult = z.infer<typeof TasksFromMessageResultSchema>;
