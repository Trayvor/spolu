import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { GlobalTaskDtoSchema } from '../home.js';
import { KnowledgeItemDtoSchema } from '../knowledge.js';
import { TaskDetailDtoSchema, TaskDtoSchema } from '../tasks.js';
import { TicketDtoSchema, TicketListItemSchema } from '../tickets.js';

/**
 * Phase 32 leak rule (spec §2.3): time and money never ride on the DTOs everyone reads. A task's
 * or ticket's time comes only from its own `/time` route, which answers about the caller unless
 * they are a finance admin. A field named like one of these on a shared DTO fails here.
 */
const FINANCE_WORDS = /minute|time(?!s?tamp)|hour|cost|rate|amount|money|finance|covered/i;
// Existing timestamps and counts that merely contain a word above.
const ALLOWED = new Set(['times', 'firedAt']);

function keysOf(schema: z.ZodObject): string[] {
  return Object.keys(schema.shape);
}

describe('no finance fields on shared DTOs', () => {
  it.each([
    ['TaskDto', TaskDtoSchema],
    ['TaskDetailDto', TaskDetailDtoSchema],
    ['GlobalTaskDto', GlobalTaskDtoSchema],
    ['TicketDto', TicketDtoSchema],
    ['TicketListItem', TicketListItemSchema],
    ['KnowledgeItemDto', KnowledgeItemDtoSchema],
  ] as const)('%s', (_name, schema) => {
    const suspicious = keysOf(schema as unknown as z.ZodObject).filter(
      (key) => FINANCE_WORDS.test(key) && !ALLOWED.has(key),
    );
    expect(suspicious).toEqual([]);
  });
});
