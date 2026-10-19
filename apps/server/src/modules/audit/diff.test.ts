import { describe, expect, it } from 'vitest';
import { diffFields, hasChanges } from './diff.js';

describe('diffFields', () => {
  it('stores only changed allowlisted fields', () => {
    const changes = diffFields(
      'task',
      { title: 'A', priority: 'high', foo: 'x' },
      { title: 'B', priority: 'high', foo: 'y' },
    );
    expect(changes).toEqual({ title: { from: 'A', to: 'B' } });
  });

  it('stores text fields as changed only', () => {
    const changes = diffFields('task', { description: 'old' }, { description: 'secret text' });
    expect(changes).toEqual({ description: { changed: true } });
    expect(JSON.stringify(changes)).not.toContain('secret text');
    expect(diffFields('task', { description: 'same' }, { description: 'same' })).toEqual({});
  });

  it('cuts a value over 200 characters with …', () => {
    const changes = diffFields('task', { title: 'a' }, { title: 'b'.repeat(300) });
    const to = (changes.title as { to: string }).to;
    expect(to).toHaveLength(200);
    expect(to.endsWith('…')).toBe(true);
  });

  it('refs give added and removed by id, keeping labels', () => {
    const a = { id: 'a', label: 'Anna' };
    const b = { id: 'b', label: 'Boris' };
    const c = { id: 'c', label: 'Cyril' };
    expect(diffFields('task', { assignees: [a, b] }, { assignees: [b, c] })).toEqual({
      assignees: { added: [c], removed: [a] },
    });
    expect(diffFields('task', { assignees: [a, b] }, { assignees: [b, a] })).toEqual({});
  });

  it('a ref compares by id', () => {
    expect(
      diffFields(
        'task',
        { bucket: { id: 'x', label: 'To do' } },
        { bucket: { id: 'x', label: 'Renamed' } },
      ),
    ).toEqual({});
    expect(diffFields('task', { bucket: { id: 'x', label: 'To do' } }, { bucket: null })).toEqual({
      bucket: { from: { id: 'x', label: 'To do' }, to: null },
    });
  });

  it('created stores to only; deleted stores from only', () => {
    expect(diffFields('task', null, { title: 'T', description: 'body', priority: null })).toEqual({
      title: { to: 'T' },
      description: { changed: true },
    });
    expect(diffFields('task', { title: 'T', description: 'body' }, null)).toEqual({
      title: { from: 'T' },
    });
    expect(diffFields('task', null, { assignees: [{ id: 'a', label: 'A' }] })).toEqual({
      assignees: { added: [{ id: 'a', label: 'A' }], removed: [] },
    });
  });

  it('dates are stored as ISO strings, money as minor and currency', () => {
    const d1 = new Date('2026-10-20T10:00:00Z');
    const d2 = new Date('2026-10-24T10:00:00Z');
    expect(diffFields('knowledge_item', { meetingAt: d1 }, { meetingAt: d2 })).toEqual({
      meetingAt: { from: d1.toISOString(), to: d2.toISOString() },
    });
    expect(
      diffFields('knowledge_item', { meetingAt: new Date(d1) }, { meetingAt: new Date(d1) }),
    ).toEqual({});
    expect(
      diffFields(
        'finance_item',
        { amount: { minor: 100, currency: 'EUR' } },
        { amount: { minor: 250, currency: 'EUR' } },
      ),
    ).toEqual({
      amount: { from: { minor: 100, currency: 'EUR' }, to: { minor: 250, currency: 'EUR' } },
    });
  });

  it('keeps at most 50 refs a list', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `u${i}`, label: `U${i}` }));
    const changes = diffFields('task', { assignees: [] }, { assignees: many });
    expect((changes.assignees as { added: unknown[] }).added).toHaveLength(50);
  });

  it('hasChanges is false for an equal before and after', () => {
    expect(hasChanges(diffFields('task', { title: 'A' }, { title: 'A' }))).toBe(false);
    expect(hasChanges(diffFields('task', { title: 'A' }, { title: 'B' }))).toBe(true);
  });
});
