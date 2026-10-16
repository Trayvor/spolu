import { describe, expect, it } from 'vitest';
import {
  isHttpUrl,
  KNOWLEDGE_LIMITS,
  KnowledgeDraftSchema,
  KnowledgePatchSchema,
  ReminderInputSchema,
} from './knowledge.js';

const at = '2026-11-01T09:00:00.000Z';
const times = (n: number) => Array.from({ length: n }, () => ({ at }));

describe('KnowledgeDraftSchema', () => {
  it('fills the defaults of a note', () => {
    expect(KnowledgeDraftSchema.parse({ type: 'note', title: ' Budget ' })).toEqual({
      type: 'note',
      title: 'Budget',
      body: '',
      visibility: 'public',
      fileIds: [],
    });
  });

  it('a file draft needs exactly one file', () => {
    const file = (fileIds: string[]) =>
      KnowledgeDraftSchema.safeParse({ type: 'file', title: 'Contract', fileIds });
    expect(file([]).success).toBe(false);
    expect(file(['a', 'b']).success).toBe(false);
    expect(file(['a']).success).toBe(true);
  });

  it('a note takes at most 10 files', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `f${i}`);
    expect(KnowledgeDraftSchema.safeParse({ type: 'note', title: 't', fileIds: ids }).success).toBe(
      false,
    );
  });

  it('a link needs an http(s) url', () => {
    const link = (url: string) => KnowledgeDraftSchema.safeParse({ type: 'link', title: 't', url });
    expect(link('ftp://x').success).toBe(false);
    expect(link('javascript:alert(1)').success).toBe(false);
    expect(link(`https://${'a'.repeat(2049)}`).success).toBe(false);
    expect(link('https://opvai.sk/vyzvy').success).toBe(true);
    expect(KnowledgeDraftSchema.safeParse({ type: 'link', title: 't' }).success).toBe(false);
  });

  it('a link and a reminder take no files', () => {
    expect(
      KnowledgeDraftSchema.safeParse({
        type: 'link',
        title: 't',
        url: 'https://opvai.sk',
        fileIds: ['a'],
      }).success,
    ).toBe(false);
    expect(
      KnowledgeDraftSchema.safeParse({
        type: 'reminder',
        title: 't',
        reminder: { times: times(1), recipientIds: [] },
        fileIds: ['a'],
      }).success,
    ).toBe(false);
  });

  it('a reminder needs 1..20 times', () => {
    const reminder = (n: number) =>
      KnowledgeDraftSchema.safeParse({
        type: 'reminder',
        title: 't',
        reminder: { times: times(n), recipientIds: [] },
      });
    expect(reminder(0).success).toBe(false);
    expect(reminder(1).success).toBe(true);
    expect(reminder(KNOWLEDGE_LIMITS.times).success).toBe(true);
    expect(reminder(KNOWLEDGE_LIMITS.times + 1).success).toBe(false);
    expect(KnowledgeDraftSchema.safeParse({ type: 'reminder', title: 't' }).success).toBe(false);
  });

  it('rejects an unknown visibility, a blank title and a 201-character title', () => {
    const note = (extra: object) =>
      KnowledgeDraftSchema.safeParse({ type: 'note', title: 't', ...extra });
    expect(note({ visibility: 'private' }).success).toBe(false);
    expect(note({ title: '  ' }).success).toBe(false);
    expect(note({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(note({ body: 'a'.repeat(10_001) }).success).toBe(false);
  });
});

describe('ReminderInputSchema', () => {
  it('recipientIds are deduplicated', () => {
    expect(
      ReminderInputSchema.parse({ times: times(1), recipientIds: ['a', 'b', 'a'] }).recipientIds,
    ).toEqual(['a', 'b']);
  });

  it('takes at most 50 recipients and needs an offset on each time', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `u${i}`);
    expect(ReminderInputSchema.safeParse({ times: times(1), recipientIds: ids }).success).toBe(
      false,
    );
    expect(
      ReminderInputSchema.safeParse({ times: [{ at: '2026-11-01T09:00' }], recipientIds: [] })
        .success,
    ).toBe(false);
  });
});

describe('KnowledgePatchSchema', () => {
  const updatedAt = '2026-10-16T10:00:00.000Z';

  it('a patch rejects type', () => {
    expect(KnowledgePatchSchema.safeParse({ type: 'note', updatedAt }).success).toBe(false);
  });

  it('needs updatedAt and leaves omitted fields out', () => {
    expect(KnowledgePatchSchema.safeParse({ title: 't' }).success).toBe(false);
    expect(KnowledgePatchSchema.parse({ title: ' New ', updatedAt })).toEqual({
      title: 'New',
      updatedAt,
    });
  });

  it('checks the url of a patch', () => {
    expect(KnowledgePatchSchema.safeParse({ url: 'ftp://x', updatedAt }).success).toBe(false);
    expect(KnowledgePatchSchema.safeParse({ url: 'https://x.sk', updatedAt }).success).toBe(true);
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https up to 2048 characters only', () => {
    expect(isHttpUrl('http://x.sk')).toBe(true);
    expect(isHttpUrl('https://x.sk/a?b=c')).toBe(true);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('mailto:a@b.sk')).toBe(false);
    const max = `https://x.sk/${'a'.repeat(KNOWLEDGE_LIMITS.url - 'https://x.sk/'.length)}`;
    expect(isHttpUrl(max)).toBe(true);
    expect(isHttpUrl(`${max}a`)).toBe(false);
  });
});
