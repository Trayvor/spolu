import { describe, expect, it } from 'vitest';
import { BucketPatchSchema, TaskDraftSchema, TaskPatchSchema } from './tasks.js';

describe('TaskDraftSchema', () => {
  it('fills defaults from { title }', () => {
    expect(TaskDraftSchema.parse({ title: 'Write report' })).toEqual({
      title: 'Write report',
      description: '',
      assigneeIds: [],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
    });
  });

  it('accepts an http(s) link, trimmed; empty or blank means null', () => {
    const link = (value: unknown) => TaskDraftSchema.parse({ title: 't', link: value }).link;
    expect(link('  https://egrant.sk/projekt?id=1  ')).toBe('https://egrant.sk/projekt?id=1');
    expect(link('http://example.com')).toBe('http://example.com');
    expect(link('')).toBeNull();
    expect(link('   ')).toBeNull();
    expect(link(null)).toBeNull();
  });

  it('rejects links that are not http(s) URLs or are too long', () => {
    const ok = (value: string) => TaskDraftSchema.safeParse({ title: 't', link: value }).success;
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('ftp://example.com/file')).toBe(false);
    expect(ok('egrant.sk')).toBe(false);
    expect(ok(`https://e.sk/${'a'.repeat(2048)}`)).toBe(false);
  });

  it('rejects a blank title and a 201-character title', () => {
    expect(TaskDraftSchema.safeParse({ title: '  ' }).success).toBe(false);
    expect(TaskDraftSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
    expect(TaskDraftSchema.safeParse({ title: 'a'.repeat(200) }).success).toBe(true);
  });

  it('rejects 11 assignees and collapses duplicate ids', () => {
    const ids = Array.from({ length: 11 }, (_, i) => `u${i}`);
    expect(TaskDraftSchema.safeParse({ title: 't', assigneeIds: ids }).success).toBe(false);
    expect(TaskDraftSchema.parse({ title: 't', assigneeIds: ['a', 'b', 'a'] }).assigneeIds).toEqual(
      ['a', 'b'],
    );
  });

  it('accepts valid dates and null, rejects impossible dates', () => {
    expect(TaskDraftSchema.safeParse({ title: 't', dueDate: '2026-02-30' }).success).toBe(false);
    expect(TaskDraftSchema.safeParse({ title: 't', dueDate: '2026-10-18' }).success).toBe(true);
    expect(TaskDraftSchema.safeParse({ title: 't', dueDate: null }).success).toBe(true);
  });
});

describe('TaskPatchSchema', () => {
  it('keeps omitted fields undefined', () => {
    const parsed = TaskPatchSchema.parse({ updatedAt: '2026-10-15T10:00:00.000Z' });
    expect(parsed).toEqual({ updatedAt: '2026-10-15T10:00:00.000Z' });
    expect(parsed.urgent).toBeUndefined();
    expect(parsed.assigneeIds).toBeUndefined();
  });

  it('accepts a link, and empty or null to clear it', () => {
    const at = '2026-10-15T10:00:00.000Z';
    expect(TaskPatchSchema.parse({ link: ' https://e.sk ', updatedAt: at }).link).toBe(
      'https://e.sk',
    );
    expect(TaskPatchSchema.parse({ link: '', updatedAt: at }).link).toBeNull();
    expect(TaskPatchSchema.parse({ link: null, updatedAt: at }).link).toBeNull();
    expect(TaskPatchSchema.safeParse({ link: 'javascript:x', updatedAt: at }).success).toBe(false);
  });

  it('requires updatedAt', () => {
    expect(TaskPatchSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('BucketPatchSchema', () => {
  it('rejects {}', () => {
    expect(BucketPatchSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a name or afterBucketId', () => {
    expect(BucketPatchSchema.safeParse({ name: ' New ' }).success).toBe(true);
    expect(BucketPatchSchema.safeParse({ afterBucketId: 'b1' }).success).toBe(true);
    expect(BucketPatchSchema.safeParse({ afterBucketId: null }).success).toBe(true);
  });
});
