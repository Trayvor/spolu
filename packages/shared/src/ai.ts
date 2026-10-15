import { z } from 'zod';

/** At most this many task cards come back from one split. */
export const AI_MAX_TASKS = 10;
export const AI_TITLE_MAX = 200;
export const AI_DESCRIPTION_MAX = 5000;

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
