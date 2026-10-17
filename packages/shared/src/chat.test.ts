import { describe, expect, it } from 'vitest';
import {
  extractMentions,
  mentionToken,
  plainExcerpt,
  SendMessageInputSchema,
  SetReactionInputSchema,
  splitMentionTokens,
} from './chat.js';
import { MENTION_CASES } from './chat-mention-cases.js';

describe('extractMentions', () => {
  it('finds users and @all, deduplicated', () => {
    const body = `hi ${mentionToken('u1')} and <@all>, ${mentionToken('u2')} ${mentionToken('u1')} <@all>`;
    expect(extractMentions(body)).toEqual({ userIds: ['u1', 'u2'], all: true });
    expect(extractMentions('no mentions')).toEqual({ userIds: [], all: false });
  });

  it('ignores tokens inside code spans and fences', () => {
    expect(extractMentions('`<@u1>` and ```\n<@u2> <@all>\n``` and <@u3>')).toEqual({
      userIds: ['u3'],
      all: false,
    });
    expect(extractMentions('```\n<@u1>')).toEqual({ userIds: [], all: false });
  });

  it.each(MENTION_CASES)('shared case %#: $body', ({ body, userIds, all }) => {
    expect(extractMentions(body)).toEqual({ userIds, all });
  });
});

describe('splitMentionTokens', () => {
  it('splits text and mentions, keeping code as text', () => {
    expect(splitMentionTokens('hi <@u1>, <@all>!')).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'mention', id: 'u1' },
      { type: 'text', text: ', ' },
      { type: 'mention', id: 'all' },
      { type: 'text', text: '!' },
    ]);
    expect(splitMentionTokens('a `<@u1>` b ```\n<@u2>\n``` <@u3>')).toEqual([
      { type: 'text', text: 'a `<@u1>` b ```\n<@u2>\n``` ' },
      { type: 'mention', id: 'u3' },
    ]);
    expect(splitMentionTokens('')).toEqual([]);
    expect(splitMentionTokens('<@u1><@u2>')).toHaveLength(2);
  });
});

describe('plainExcerpt', () => {
  const nameOf = (id: string) => (id === 'u1' ? 'Anna' : undefined);

  it('replaces tokens with names and cuts at 140 with an ellipsis', () => {
    expect(plainExcerpt('hi <@u1>,  <@u9>\n\n <@all>', nameOf, 140)).toBe('hi @Anna, @? @all');
    expect(plainExcerpt('<@all>', nameOf, 140, '@everyone')).toBe('@everyone');
    const cut = plainExcerpt('a'.repeat(200), nameOf, 140);
    expect(cut).toHaveLength(141);
    expect(cut.endsWith('…')).toBe(true);
    expect(plainExcerpt('a'.repeat(140), nameOf, 140)).toBe('a'.repeat(140));
  });
});

describe('SendMessageInputSchema', () => {
  const base = { body: 'hello', clientId: 'c1' };

  it('rejects an empty body without files, 10 001 chars, 11 files, replyToId without parentId', () => {
    expect(SendMessageInputSchema.safeParse({ ...base, body: '   ' }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ ...base, body: 'a'.repeat(10_001) }).success).toBe(
      false,
    );
    const files = Array.from({ length: 11 }, (_, i) => `f${i}`);
    expect(SendMessageInputSchema.safeParse({ ...base, fileIds: files }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ ...base, fileIds: ['a', 'a'] }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ ...base, replyToId: 'm1' }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ ...base, clientId: '' }).success).toBe(false);
    expect(
      SendMessageInputSchema.safeParse({ ...base, parentId: 'p', replyToId: 'm1' }).success,
    ).toBe(true);
  });

  it('accepts an empty body with one file', () => {
    expect(SendMessageInputSchema.safeParse({ ...base, body: '', fileIds: ['f1'] }).success).toBe(
      true,
    );
  });
});

describe('SetReactionInputSchema', () => {
  const ok = (emoji: string) => SetReactionInputSchema.safeParse({ emoji, on: true }).success;

  it('takes one emoji with its modifiers, joiners, flags and keycaps', () => {
    for (const emoji of ['👍', '❤️', '✅', '👍🏽', '👩‍💻', '🇸🇰', '1️⃣', '🏳️‍🌈']) {
      expect(ok(emoji), emoji).toBe(true);
    }
  });

  it('refuses text, digits, empty and overlong values', () => {
    for (const emoji of ['', 'a', 'ok', '1', '#', ' ', '👍 ', '<b>', '👍👍', '👍'.repeat(17)]) {
      expect(ok(emoji), emoji).toBe(false);
    }
  });
});

describe('SendMessageInputSchema knowledgeIds', () => {
  it('a message may carry only knowledge items, at most 5 and no duplicates', () => {
    const base = { body: '', clientId: 'c1' };
    expect(SendMessageInputSchema.safeParse({ ...base, knowledgeIds: ['k1'] }).success).toBe(true);
    expect(SendMessageInputSchema.safeParse({ ...base, knowledgeIds: [] }).success).toBe(false);
    expect(SendMessageInputSchema.safeParse({ ...base, knowledgeIds: ['k1', 'k1'] }).success).toBe(
      false,
    );
    expect(
      SendMessageInputSchema.safeParse({
        ...base,
        knowledgeIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      }).success,
    ).toBe(false);
  });
});
