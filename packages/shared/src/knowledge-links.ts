import { z } from 'zod';
import { IdSchema, MessageKnowledgeSchema } from './chat.js';

/**
 * Phase 33 part P5: knowledge items attached to a description (a task's, a ticket's, a
 * project's, an event's or a knowledge item's), shown as the chat's cards under the text.
 */
export const KNOWLEDGE_LINKS_MAX = 10;

/** `knowledgeIds` in a body: at most 10 distinct ids, in display order; absent leaves them. */
export const KnowledgeIdsSchema = z
  .array(IdSchema)
  .max(KNOWLEDGE_LINKS_MAX)
  .refine((ids) => new Set(ids).size === ids.length);

/** `linkedKnowledge` in a DTO: a card while everyone who reads the text may see it, else its id. */
export const LinkedKnowledgeSchema = z.array(MessageKnowledgeSchema);
export type LinkedKnowledge = z.infer<typeof LinkedKnowledgeSchema>;
