import { describe, expect, it } from 'vitest';
import {
  EMPTY_WEEKLY_CONTENT,
  WeeklySummaryArchiveQuerySchema,
  WeeklySummaryContentSchema,
  WeeklySummaryItemSchema,
  WeeklySummaryListQuerySchema,
  WeeklySummaryStatuses,
} from './weekly-summary.js';

const uuid = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const item = (text: string) => ({ id: uuid, ref: null, text });

describe('weekly summary schemas', () => {
  it('content accepts the empty draft', () => {
    expect(WeeklySummaryContentSchema.parse(EMPTY_WEEKLY_CONTENT)).toEqual({
      intro: '',
      done: [],
      waiting: [],
      upcoming: [],
      closing: '',
    });
  });

  it('an item longer than 500 characters is rejected', () => {
    expect(WeeklySummaryItemSchema.safeParse(item('a'.repeat(501))).success).toBe(false);
    expect(WeeklySummaryItemSchema.safeParse(item('a'.repeat(500))).success).toBe(true);
  });

  it('a section with 31 items is rejected', () => {
    const items = Array.from({ length: 31 }, () => item('x'));
    expect(
      WeeklySummaryContentSchema.safeParse({ ...EMPTY_WEEKLY_CONTENT, done: items }).success,
    ).toBe(false);
    expect(
      WeeklySummaryContentSchema.safeParse({ ...EMPTY_WEEKLY_CONTENT, done: items.slice(1) })
        .success,
    ).toBe(true);
  });

  it('an item with a whitespace-only text is rejected', () => {
    expect(WeeklySummaryItemSchema.safeParse(item('   ')).success).toBe(false);
  });

  it('the list query defaults to mine and review', () => {
    expect(WeeklySummaryListQuerySchema.parse({})).toMatchObject({
      scope: 'mine',
      status: 'review',
      limit: 50,
    });
    expect(WeeklySummaryListQuerySchema.safeParse({ week: '2026-43' }).success).toBe(false);
    expect(WeeklySummaryListQuerySchema.safeParse({ week: '2026-W43' }).success).toBe(true);
  });

  it('a ref kind outside task, ticket, event is rejected', () => {
    expect(
      WeeklySummaryItemSchema.safeParse({
        id: uuid,
        ref: { kind: 'knowledge', id: 'k' },
        text: 'x',
      }).success,
    ).toBe(false);
    expect(
      WeeklySummaryItemSchema.safeParse({ id: uuid, ref: { kind: 'event', id: 'e' }, text: 'x' })
        .success,
    ).toBe(true);
  });

  it('there is no expired status', () => {
    expect(WeeklySummaryStatuses).not.toContain('expired');
  });

  it('the archive query defaults to all statuses and 20 a page and rejects from after to', () => {
    expect(WeeklySummaryArchiveQuerySchema.parse({})).toMatchObject({ status: 'all', limit: 20 });
    expect(
      WeeklySummaryArchiveQuerySchema.safeParse({ from: '2026-06-30', to: '2026-03-01' }).success,
    ).toBe(false);
    expect(
      WeeklySummaryArchiveQuerySchema.safeParse({ from: '2026-03-01', to: '2026-06-30' }).success,
    ).toBe(true);
    expect(WeeklySummaryArchiveQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(WeeklySummaryArchiveQuerySchema.safeParse({ q: ' ab ' }).data?.q).toBe('ab');
  });
});
