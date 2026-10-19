import { describe, expect, it } from 'vitest';
import { TicketDraftRequestSchema, TicketDraftSchema } from './ticket-draft.js';

describe('ticket draft schemas', () => {
  it('defaults instructions to an empty string and caps them at 1000', () => {
    expect(TicketDraftRequestSchema.parse({})).toEqual({ instructions: '' });
    expect(TicketDraftRequestSchema.safeParse({ instructions: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });

  it('accepts both source kinds', () => {
    expect(
      TicketDraftSchema.parse({
        reply: 'Dobrý deň',
        sources: [
          { kind: 'knowledge', id: 'k1', type: 'note', title: 'Postup', fromAdminGroup: false },
          { kind: 'ticket', id: 't1', number: 98, subject: null },
        ],
      }).sources,
    ).toHaveLength(2);
  });
});
