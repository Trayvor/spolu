import { describe, expect, it } from 'vitest';
import { extractMentions, mentionToken, plainExcerpt, SendMessageInputSchema } from './chat.js';

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
