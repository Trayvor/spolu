import { describe, expect, it } from 'vitest';
import { formatDue, isOverdue, todayInBratislava } from './dates';

describe('dates', () => {
  it('isOverdue uses the Bratislava date', () => {
    const today = todayInBratislava(new Date('2026-10-17T23:30:00Z'));
    expect(today).toBe('2026-10-18');
    expect(isOverdue('2026-10-17', 'todo', today)).toBe(true);
    expect(isOverdue('2026-10-18', 'todo', today)).toBe(false);
    expect(isOverdue('2026-10-17', 'done', today)).toBe(false);
    expect(isOverdue(null, 'todo', today)).toBe(false);
  });

  it('formatDue shows day and short month', () => {
    expect(formatDue('2026-10-18', 'en')).toBe('18 Oct');
    expect(formatDue('2026-10-18', 'en-US')).toBe('18 Oct');
  });
});
