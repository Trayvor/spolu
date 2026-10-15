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
    });
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
