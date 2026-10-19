import { describe, expect, it } from 'vitest';
import { MessageSearchQuerySchema, SEARCH_LIMITS, SearchQuerySchema } from './search.js';

describe('search query schemas', () => {
  it('accepts messages as a type and includes it by default', () => {
    expect(SearchQuerySchema.parse({ q: 'ab', types: 'messages' }).types).toEqual(['messages']);
    expect(SearchQuerySchema.parse({ q: 'ab' }).types).toContain('messages');
  });

  it('message search query: limits and defaults', () => {
    expect(MessageSearchQuerySchema.parse({ q: ' zmluva ' })).toEqual({ q: 'zmluva', limit: 20 });
    expect(
      MessageSearchQuerySchema.parse({ q: 'ab', limit: '5', cursor: 'x', groupId: 'g' }),
    ).toEqual({ q: 'ab', limit: 5, cursor: 'x', groupId: 'g' });
    expect(MessageSearchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(MessageSearchQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(MessageSearchQuerySchema.safeParse({ q: 'ab', limit: '21' }).success).toBe(false);
    expect(MessageSearchQuerySchema.safeParse({ q: 'ab', limit: '0' }).success).toBe(false);
    expect(MessageSearchQuerySchema.safeParse({ q: 'ab', cursor: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(MessageSearchQuerySchema.safeParse({ q: 'ab', groupId: 'x'.repeat(65) }).success).toBe(
      false,
    );
  });

  it('messages need a term of three characters', () => {
    expect(SEARCH_LIMITS.minMessageTerm).toBe(3);
    expect(SEARCH_LIMITS.messagesPage).toBe(20);
  });
});
